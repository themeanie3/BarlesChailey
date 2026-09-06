# Architecture

## Goals

1. **Never miss a serious call nearby.** Off-duty members with ALS gear in their car should
   know about a structure fire, entrapment or cardiac arrest within minutes-of-driving range,
   even with the phone locked, muted, or in a Focus mode.
2. **One feed, many apps.** The raw FSAS HTML never leaves the ingest layer. Everything
   downstream (this app, the station dashboard, future tools) reads one versioned JSON contract.
3. **Free to run.** Cloudflare Workers free tier, Neon free tier, Expo push. The design keeps the
   database asleep except for a few short wakes per hour, which is what makes the Neon free
   quota (100 compute-hours/month) last the whole month.

## Data flow

```
Pi: IYAFYLv3.py ──(unchanged)──▶ table_bus.publish_table(html)
                 └── publisher/push_to_feed.py ──POST /push (X-Push-Secret, X-Feed-Ts)──▶ Worker
                                                                                            │
                     BoardState Durable Object (SQLite) ◀───────────────────────────────────┘
                     parse → diff → classify → geocode (alertable only) → match devices → Expo push
                                │ alarm every FLUSH_INTERVAL_MINUTES (30)
                                ▼
                     Neon Postgres (history, members, preferences, RLS, Neon Auth)
```

**Hot path — `services/api/src/board/board-state.ts`.** One Durable Object per feed source owns:

* the live board (`incidents`, `incident_events`), identity = `dispatch time | address | box`
  (the same key sta03's changelog uses) so code upgrades (HOUSE → UBOX) and unit changes are
  updates, not new incidents;
* every device's last fix and the members' preference mirror;
* the alert idempotency table (`UNIQUE (incident_id, device_id, kind)`), the geocode cache, and
  caches of membership / API keys so authenticated reads never touch Postgres.

Per push: `diffBoard()` (pure, tested) computes inserts/updates/clears/events → one SQLite
transaction → the station gets its `ok` → then, off the request path, alertable new incidents
are geocoded (cache first, Google second, bounded to the DC-area bbox) and `matchDevices()`
(pure haversine over ≤ a few dozen devices; radius, home point, location age, category,
minimum severity, quiet hours, snooze, upgrade opt-out) picks who to page. Claims are written
with `INSERT OR IGNORE` before sending so two racing pushes can't double-page. One Expo Push API
call per incident, chunks of 100; the iOS payload carries the **critical sound** when both the
deployment (`ALERTS_CRITICAL_SOUND`) and the device (`critical_alerts_authorized`) allow it,
otherwise the `time-sensitive` interruption level (breaks Focus, respects mute).

**Cold path — Neon.** The object's alarm runs every 30 minutes: dirty incidents/events/devices/
alerts go to Postgres in **one** `sql.transaction`, push receipts are checked, stale incidents
(unseen 6 h) and expired simulations are closed, and rows older than 7–30 days are pruned from
SQLite (Postgres keeps history). Nothing dirty → no database wake. A 6-hourly Worker cron only
re-arms the alarm as a watchdog.

Estimated Neon usage at county volume: ~50 flush wakes/day × ~5 minutes ≈ 4 h/day ≈ 30–60
compute-hours/month, inside the free 100. The old design (every push hitting Postgres) would have
burned the quota by mid-month.

## Identity and authorization

* **Neon Managed Better Auth** is the identity provider. The app signs in with native Google
  (ID-token flow) or an emailed one-time code.
* The app then asks Neon for a short-lived JWT (`/token`) and exchanges it **once** at
  `POST /v1/auth/exchange` for a 30-day API token (HS256, `API_TOKEN_SECRET`). Every other call
  uses the API token, so polling and location pings never wake Neon Auth or the database.
* Membership is an allowlist (`members` table). First sign-in by an address in `ADMIN_EMAILS`
  becomes an active admin; everyone else is `pending` until an admin approves them in Settings.
  The Durable Object caches membership for a day; admin changes update the cache immediately.
* Server-to-server consumers use hashed **API keys** with scopes `read:feed` / `ingest`
  (cached 10 minutes in the object).
* Every responder-owned table has **RLS policies** keyed on `auth.user_id()` so the Neon Data
  API can be exposed directly later; the Worker uses the owner role and filters by user id.
* Location privacy: only the **latest** fix per device is kept (one row), and the app throttles
  uploads to changes ≥ 200 m / 10 min.

## The feed contract

`packages/feed/src/index.ts` (zod + TypeScript) and `packages/feed/openapi.yaml`. Consumers read
`GET /v1/incidents` (live board, last 7 days; `?archive=1` for Postgres history) and
`GET /v1/incidents/:id` (with timeline). Call-type grading is documented in
[CALL_TYPES.md](CALL_TYPES.md) and lives in the `call_type_rules` table (mirrored into the object).

## The app (Expo SDK 57)

* `app/_layout.tsx` imports the background location task at module scope (iOS requirement), sets
  the foreground notification handler, and routes notification taps to `/incident/:id`.
* `(app)/_layout.tsx` gates on session + membership, registers the Expo push token (asking for
  critical alerts only when the build carries the entitlement), starts `Always` location
  updates (balanced accuracy, 250 m / 2 min, deferred in background), and re-syncs on foreground.
* Screens: Board (15 s polling while active, "serious calls" filter), Incident (Apple Maps,
  Navigate via Apple/Google/Waze, timeline), My alerts, Settings (radius, categories, severity,
  home point, quiet hours, snooze, test alert; admins: approve members, simulate a call).

## Environments

| | Worker | Neon branch | Neon Auth | EAS environment |
|---|---|---|---|---|
| development (dev client) | `wrangler dev` or staging | dev | dev branch URL | `development` |
| staging / TestFlight-internal | `barleschailey-api-staging` | dev | dev branch URL | `preview` |
| production | `barleschailey-api` | production | production URL | `production` |

Neon branches carry auth state with them, so staging sign-ins never touch production users.
Each Worker environment has its own Durable Object namespace.

## Why these choices

* **Durable Object for the hot path:** the only free primitive with per-object SQLite, alarms and
  single-writer semantics. KV allows 1,000 writes/day (too few), D1 has no alarms and would
  force a second auth stack. Verified limits: DO free tier 5M rows read / 100k written per day.
* **Neon stays:** PostGIS, RLS, branching for staging, Managed Better Auth with Google, and the
  free tier is generous once the feed stops keeping it awake. Neon Launch is usage-priced
  (~$19/month always-on), so sleeping matters.
* **Expo push over raw APNs:** supports the iOS critical-sound payload, handles token rotation
  and receipts, keeps the Worker free of HTTP/2 client concerns.
* **Native Google ID-token sign-in over browser redirects:** no deep-link cookie relay is needed,
  so it works with Neon's managed (server-plugin-less) Better Auth. Email codes are the fallback.
