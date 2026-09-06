/** SQLite schema for the BoardState Durable Object. Applied idempotently on construction. */
export const BOARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  dispatched_at TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  lat REAL,
  lon REAL,
  formatted_address TEXT,
  geocode_status TEXT NOT NULL DEFAULT 'pending',
  geocode_attempts INTEGER NOT NULL DEFAULT 0,
  call_code TEXT NOT NULL,
  call_description TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  alertable INTEGER NOT NULL DEFAULT 0,
  is_upgrade INTEGER NOT NULL DEFAULT 0,
  box TEXT,
  station TEXT,
  battalion TEXT,
  units TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  cleared_at TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status, updated_at);
CREATE INDEX IF NOT EXISTS incidents_dirty_idx ON incidents (dirty);

CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  flushed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON incident_events (incident_id, at);
CREATE INDEX IF NOT EXISTS incident_events_flushed_idx ON incident_events (flushed);

CREATE TABLE IF NOT EXISTS members (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  device_name TEXT,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  critical_alerts_authorized INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  lat REAL,
  lon REAL,
  accuracy_m REAL,
  speed_mps REAL,
  recorded_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices (user_id);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  incident_id TEXT,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  distance_m REAL,
  matched_by TEXT,
  sent_at TEXT NOT NULL,
  expo_ticket_id TEXT,
  receipt_status TEXT NOT NULL DEFAULT 'pending',
  receipt_error TEXT,
  payload TEXT,
  dirty INTEGER NOT NULL DEFAULT 1,
  UNIQUE (incident_id, device_id, kind)
);
CREATE INDEX IF NOT EXISTS alerts_user_idx ON alerts (user_id, sent_at);
CREATE INDEX IF NOT EXISTS alerts_receipt_idx ON alerts (receipt_status, sent_at);

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  query_key TEXT PRIMARY KEY,
  lat REAL,
  lon REAL,
  formatted_address TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  alertable INTEGER NOT NULL,
  is_upgrade INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;
