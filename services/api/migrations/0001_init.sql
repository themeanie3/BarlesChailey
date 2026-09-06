-- BarlesChailey feed + alert engine schema, v1.
-- Idempotent where practical so it can be re-applied to Neon branches.
-- Statements are separated by "dash dash at at" marker lines (see services/api/scripts/migrate.ts).

-- @@
CREATE EXTENSION IF NOT EXISTS postgis;
-- @@
CREATE EXTENSION IF NOT EXISTS citext;

-- @@
DO $$ BEGIN
  CREATE TYPE incident_category AS ENUM ('fire','rescue','ems','hazmat','service','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE severity AS ENUM ('low','normal','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE incident_status AS ENUM ('active','cleared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE geocode_status AS ENUM ('pending','ok','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE incident_event_kind AS ENUM ('created','call_type_changed','units_changed','geocoded','cleared','reopened');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE alert_kind AS ENUM ('dispatch','upgrade','test');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE receipt_status AS ENUM ('pending','ok','error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE member_role AS ENUM ('admin','member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE member_status AS ENUM ('pending','active','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- @@
DO $$ BEGIN
  CREATE TYPE device_platform AS ENUM ('ios','android');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- @@
CREATE OR REPLACE FUNCTION severity_rank(s severity) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE s WHEN 'low' THEN 0 WHEN 'normal' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 END
$$;

-- @@
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only bump updated_at when something a consumer cares about changed.
  -- last_seen_at is refreshed on every station push and must not move the
  -- "since" cursor that clients poll with.
  IF NEW.version IS DISTINCT FROM OLD.version
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.lat IS DISTINCT FROM OLD.lat
     OR NEW.lon IS DISTINCT FROM OLD.lon THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Feed: call-type rules, incidents, events, source heartbeat
-- ---------------------------------------------------------------------------
-- @@
CREATE TABLE IF NOT EXISTS call_type_rules (
  code            text PRIMARY KEY,
  description     text NOT NULL,
  category        incident_category NOT NULL,
  severity        severity NOT NULL,
  alertable       boolean NOT NULL DEFAULT false,
  is_upgrade      boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- @@
CREATE TABLE IF NOT EXISTS incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL,
  source_key        text NOT NULL,
  status            incident_status NOT NULL DEFAULT 'active',
  dispatched_at     timestamptz NOT NULL,
  address           text NOT NULL,
  city              text,
  lat               double precision,
  lon               double precision,
  geom              geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
  formatted_address text,
  geocode_status    geocode_status NOT NULL DEFAULT 'pending',
  call_code         text NOT NULL,
  call_description  text NOT NULL,
  category          incident_category NOT NULL,
  severity          severity NOT NULL,
  alertable         boolean NOT NULL DEFAULT false,
  box               text,
  station           text,
  battalion         text,
  units             text[] NOT NULL DEFAULT '{}',
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  cleared_at        timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 0,
  raw               jsonb,
  UNIQUE (source, source_key)
);
-- @@
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status, last_seen_at DESC);
-- @@
CREATE INDEX IF NOT EXISTS incidents_dispatched_idx ON incidents (dispatched_at DESC);
-- @@
CREATE INDEX IF NOT EXISTS incidents_updated_idx ON incidents (updated_at DESC);
-- @@
CREATE INDEX IF NOT EXISTS incidents_geom_idx ON incidents USING GIST (geom);
-- @@
DROP TRIGGER IF EXISTS incidents_set_updated_at ON incidents;
-- @@
CREATE TRIGGER incidents_set_updated_at BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- @@
CREATE TABLE IF NOT EXISTS incident_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind         incident_event_kind NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  data         jsonb NOT NULL DEFAULT '{}'::jsonb
);
-- @@
CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON incident_events (incident_id, at);

-- @@
CREATE TABLE IF NOT EXISTS feed_sources (
  source            text PRIMARY KEY,
  last_push_at      timestamptz,
  last_push_ts      double precision,
  last_row_count    integer,
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- @@
CREATE TABLE IF NOT EXISTS geocode_cache (
  query_key          text PRIMARY KEY,
  lat                double precision,
  lon                double precision,
  formatted_address  text,
  provider           text NOT NULL,
  status             geocode_status NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Responders: membership allowlist, preferences, devices, locations, alerts
-- ---------------------------------------------------------------------------
-- @@
CREATE TABLE IF NOT EXISTS members (
  email         citext PRIMARY KEY,
  user_id       text UNIQUE,
  role          member_role NOT NULL DEFAULT 'member',
  status        member_status NOT NULL DEFAULT 'pending',
  display_name  text,
  invited_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- @@
CREATE TABLE IF NOT EXISTS alert_preferences (
  user_id                 text PRIMARY KEY,
  enabled                 boolean NOT NULL DEFAULT true,
  radius_miles            numeric(5,2) NOT NULL DEFAULT 5 CHECK (radius_miles >= 0.25 AND radius_miles <= 50),
  categories              incident_category[] NOT NULL DEFAULT '{}',
  min_severity            severity NOT NULL DEFAULT 'high',
  location_max_age_hours  integer NOT NULL DEFAULT 12 CHECK (location_max_age_hours BETWEEN 1 AND 168),
  home_lat                double precision,
  home_lon                double precision,
  home_radius_miles       numeric(5,2) CHECK (home_radius_miles IS NULL OR (home_radius_miles >= 0.25 AND home_radius_miles <= 50)),
  home_label              text,
  home_geom               geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(home_lon, home_lat), 4326)::geography) STORED,
  quiet_start             time,
  quiet_end               time,
  quiet_allow_critical    boolean NOT NULL DEFAULT true,
  snooze_until            timestamptz,
  alert_on_upgrade        boolean NOT NULL DEFAULT true,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
-- @@
CREATE INDEX IF NOT EXISTS alert_preferences_home_geom_idx ON alert_preferences USING GIST (home_geom);

-- @@
CREATE TABLE IF NOT EXISTS devices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     text NOT NULL,
  expo_push_token             text NOT NULL UNIQUE,
  platform                    device_platform NOT NULL,
  app_version                 text NOT NULL,
  device_name                 text,
  push_enabled                boolean NOT NULL DEFAULT true,
  critical_alerts_authorized  boolean NOT NULL DEFAULT false,
  disabled_reason             text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  last_seen_at                timestamptz NOT NULL DEFAULT now()
);
-- @@
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (user_id);

-- @@
CREATE TABLE IF NOT EXISTS device_locations (
  device_id    uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  lat          double precision NOT NULL,
  lon          double precision NOT NULL,
  geom         geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
  accuracy_m   double precision,
  speed_mps    double precision,
  recorded_at  timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- @@
CREATE INDEX IF NOT EXISTS device_locations_geom_idx ON device_locations USING GIST (geom);
-- @@
CREATE INDEX IF NOT EXISTS device_locations_recorded_idx ON device_locations (recorded_at DESC);

-- @@
CREATE TABLE IF NOT EXISTS alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            alert_kind NOT NULL,
  incident_id     uuid REFERENCES incidents(id) ON DELETE SET NULL,
  device_id       uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  distance_m      double precision,
  matched_by      text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  expo_ticket_id  text,
  receipt_status  receipt_status NOT NULL DEFAULT 'pending',
  receipt_error   text,
  payload         jsonb
);
-- @@
CREATE UNIQUE INDEX IF NOT EXISTS alerts_once_per_device_idx ON alerts (incident_id, device_id, kind) WHERE incident_id IS NOT NULL;
-- @@
CREATE INDEX IF NOT EXISTS alerts_user_sent_idx ON alerts (user_id, sent_at DESC);
-- @@
CREATE INDEX IF NOT EXISTS alerts_receipt_pending_idx ON alerts (sent_at) WHERE receipt_status = 'pending' AND expo_ticket_id IS NOT NULL;

-- @@
CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  key_hash      text NOT NULL UNIQUE,
  scopes        text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- Row-level security for the Neon Data API / `authenticated` role.
-- The Worker connects as the owner role (bypasses RLS) for the alert engine and
-- filters by user id explicitly; these policies are defense in depth and make
-- the tables safe to expose directly through the Data API later.
-- ---------------------------------------------------------------------------
-- @@
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE device_locations ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE call_type_rules ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE feed_sources ENABLE ROW LEVEL SECURITY;

-- @@
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'user_id') THEN

    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON incidents, incident_events, call_type_rules, feed_sources, members TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON alert_preferences, devices, device_locations TO authenticated;
    GRANT SELECT ON alerts TO authenticated;

    -- Members can see their own membership row.
    DROP POLICY IF EXISTS members_self ON members;
    CREATE POLICY members_self ON members FOR SELECT TO authenticated
      USING (user_id = auth.user_id());

    -- Feed tables are readable by any active member.
    DROP POLICY IF EXISTS incidents_member_read ON incidents;
    CREATE POLICY incidents_member_read ON incidents FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.user_id() AND m.status = 'active'));
    DROP POLICY IF EXISTS incident_events_member_read ON incident_events;
    CREATE POLICY incident_events_member_read ON incident_events FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.user_id() AND m.status = 'active'));
    DROP POLICY IF EXISTS call_type_rules_member_read ON call_type_rules;
    CREATE POLICY call_type_rules_member_read ON call_type_rules FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.user_id() AND m.status = 'active'));
    DROP POLICY IF EXISTS feed_sources_member_read ON feed_sources;
    CREATE POLICY feed_sources_member_read ON feed_sources FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.user_id() AND m.status = 'active'));

    -- Responder-owned rows.
    DROP POLICY IF EXISTS alert_preferences_owner ON alert_preferences;
    CREATE POLICY alert_preferences_owner ON alert_preferences FOR ALL TO authenticated
      USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id());
    DROP POLICY IF EXISTS devices_owner ON devices;
    CREATE POLICY devices_owner ON devices FOR ALL TO authenticated
      USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id());
    DROP POLICY IF EXISTS device_locations_owner ON device_locations;
    CREATE POLICY device_locations_owner ON device_locations FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM devices d WHERE d.id = device_id AND d.user_id = auth.user_id()))
      WITH CHECK (EXISTS (SELECT 1 FROM devices d WHERE d.id = device_id AND d.user_id = auth.user_id()));
    DROP POLICY IF EXISTS alerts_owner_read ON alerts;
    CREATE POLICY alerts_owner_read ON alerts FOR SELECT TO authenticated
      USING (user_id = auth.user_id());
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Seed: call-type rules (keep in sync with packages/feed/src/call-types.ts)
-- ---------------------------------------------------------------------------
-- @@
INSERT INTO call_type_rules (code, description, category, severity, alertable, is_upgrade) VALUES
  ('HOUSE','House fire','fire','critical',true,false),
  ('HOUSET','House fire, occupants trapped','fire','critical',true,false),
  ('BLDGFIRE','Building fire','fire','critical',true,false),
  ('BLDGFIRET','Building fire, occupants trapped','fire','critical',true,false),
  ('BLDGFREX','Building fire with explosion','fire','critical',true,false),
  ('BLDGFREXH','Building fire with explosion, hazmat','fire','critical',true,false),
  ('BLDGFRHR','High-rise building fire','fire','critical',true,false),
  ('BLDGFRHRT','High-rise building fire, occupants trapped','fire','critical',true,false),
  ('BLDGFRH','Building fire, hazmat','fire','critical',true,false),
  ('BLDGFRHM','Building fire, hazmat','fire','critical',true,false),
  ('BLDGFRHMT','Building fire, hazmat, occupants trapped','fire','critical',true,false),
  ('BLDGFRSMT','Building fire, smoke showing, trapped','fire','critical',true,false),
  ('BUILDING','Building fire','fire','critical',true,false),
  ('CHIMNEY','Chimney fire','fire','high',true,false),
  ('VEHFIRPRK','Vehicle fire in parking garage','fire','high',true,false),
  ('VEHFRTRH','Vehicle fire, hazmat','fire','high',true,false),
  ('DECKOVER','Deck / outside fire threatening structure','fire','high',true,false),
  ('UBOX','Box alarm upgrade (working fire)','fire','critical',true,true),
  ('UBOXHR','High-rise box upgrade','fire','critical',true,true),
  ('UBOXW','Box upgrade, working fire','fire','critical',true,true),
  ('MAFULL','Mutual aid full assignment','fire','critical',true,true),
  ('PICEXB','Collision on expressway / beltway','rescue','high',true,false),
  ('VEHFRTRAP','Vehicle fire with entrapment','rescue','critical',true,false),
  ('FLDVEHT','Vehicle in flood water, occupants trapped','rescue','critical',true,false),
  ('PIC2','Collision, ALS-2','rescue','high',true,false),
  ('PICTRAP1','Collision with entrapment','rescue','critical',true,false),
  ('PIC1TRAP','Collision with entrapment','rescue','critical',true,false),
  ('PICTRAP2','Collision with entrapment, ALS-2','rescue','critical',true,false),
  ('PICTRAPF2','Collision with entrapment and fire, ALS-2','rescue','critical',true,false),
  ('PICTRPHM1','Collision with entrapment, hazmat','rescue','critical',true,false),
  ('PICTRPHM2','Collision with entrapment, hazmat, ALS-2','rescue','critical',true,false),
  ('PICTRFHM2','Collision, entrapment, fire and hazmat, ALS-2','rescue','critical',true,false),
  ('PICTRFM2','Collision with entrapment and fire, ALS-2','rescue','critical',true,false),
  ('PICHM2','Collision with hazmat, ALS-2','rescue','high',true,false),
  ('PICMULT1','Multi-vehicle collision','rescue','critical',true,false),
  ('PICMULT2','Multi-vehicle collision, ALS-2','rescue','critical',true,false),
  ('METRO','Metro rail incident','rescue','critical',true,false),
  ('METRORESQP','Metro rescue, person','rescue','critical',true,false),
  ('METCRSH','Metro crash','rescue','critical',true,false),
  ('TRAINPED','Train vs pedestrian','rescue','critical',true,false),
  ('TRAINCRSH','Train crash','rescue','critical',true,false),
  ('TRAINFIRE','Train fire','rescue','critical',true,false),
  ('ENTRAP1','Entrapment','rescue','critical',true,false),
  ('ENTRAP2','Entrapment, ALS-2','rescue','critical',true,false),
  ('ENTRAPHM2','Entrapment with hazmat, ALS-2','rescue','critical',true,false),
  ('TRTCOLAPS','Structural collapse','rescue','critical',true,false),
  ('TRTCOLAPW','Structural collapse with victims','rescue','critical',true,false),
  ('TRTCONFIN','Confined space rescue','rescue','critical',true,false),
  ('TRTTECH','Technical rescue','rescue','critical',true,false),
  ('TRTTRENCH','Trench rescue','rescue','critical',true,false),
  ('AIRFULLE','Aircraft emergency, full assignment','rescue','critical',true,false),
  ('AIRCRSHF','Aircraft crash with fire','rescue','critical',true,false),
  ('AIRCRSHFW','Aircraft crash with fire, water','rescue','critical',true,false),
  ('AIRCRSHP','Aircraft crash','rescue','critical',true,false),
  ('AIRFIREL','Aircraft fire on landing','rescue','critical',true,false),
  ('CPR2','Cardiac arrest','ems','critical',true,false),
  ('CPROD2','Cardiac arrest, overdose','ems','critical',true,false),
  ('CPRSHOT2','Cardiac arrest, gunshot','ems','critical',true,false),
  ('CPRSTAB2','Cardiac arrest, stabbing','ems','critical',true,false),
  ('CPRTRAUM2','Cardiac arrest, trauma','ems','critical',true,false),
  ('CPRDROWN2','Cardiac arrest, drowning','ems','critical',true,false),
  ('CPRHEMM2','Cardiac arrest, hemorrhage','ems','critical',true,false),
  ('CPRHM2','Cardiac arrest, hazmat','ems','critical',true,false),
  ('UCODE','Unconscious, possible code','ems','critical',true,false),
  ('UNCON2','Unconscious, ALS-2','ems','critical',true,false),
  ('DROWN2','Drowning','ems','critical',true,false),
  ('ELECTRO2','Electrocution','ems','critical',true,false),
  ('ELECTROM','Electrocution, multiple patients','ems','critical',true,false),
  ('CHOKING2','Choking, ALS-2','ems','critical',true,false),
  ('ALLERGIC2','Allergic reaction, ALS-2','ems','high',true,false),
  ('SHOOTA1','Shooting','ems','high',true,false),
  ('SHOOTA2','Shooting, ALS-2','ems','critical',true,false),
  ('SHOTPOL2','Shooting, police on scene, ALS-2','ems','critical',true,false),
  ('SHOTPOLM','Shooting, multiple patients','ems','critical',true,false),
  ('STAB1','Stabbing','ems','high',true,false),
  ('STAB2','Stabbing, ALS-2','ems','critical',true,false),
  ('STABPOL2','Stabbing, police on scene, ALS-2','ems','critical',true,false),
  ('STABPOLM','Stabbing, multiple patients','ems','critical',true,false),
  ('TRAUMPOL2','Trauma, police on scene, ALS-2','ems','critical',true,false),
  ('TRAUMPOLM','Trauma, multiple patients','ems','critical',true,false),
  ('BURN2','Burns, ALS-2','ems','high',true,false),
  ('BURNADA2','Burns, ALS-2','ems','high',true,false),
  ('BURNMPD2','Burns, multiple patients','ems','high',true,false),
  ('FALL2','Fall, ALS-2','ems','high',true,false),
  ('FALLPOL2','Fall, police on scene, ALS-2','ems','high',true,false),
  ('OD2','Overdose, ALS-2','ems','high',true,false),
  ('ODINT2','Overdose, intentional, ALS-2','ems','high',true,false),
  ('ODPOL2','Overdose, police on scene, ALS-2','ems','high',true,false),
  ('TB2','Trouble breathing, ALS-2','ems','high',true,false),
  ('TBPOL2','Trouble breathing, police on scene, ALS-2','ems','high',true,false),
  ('INJURED2','Injured person, ALS-2','ems','high',true,false),
  ('PICPED1','Pedestrian struck','ems','high',true,false),
  ('PICCYCLE1','Cyclist struck','ems','high',true,false)
ON CONFLICT (code) DO NOTHING;

-- @@
INSERT INTO feed_sources (source) VALUES ('mcfrs-fsas') ON CONFLICT (source) DO NOTHING;
