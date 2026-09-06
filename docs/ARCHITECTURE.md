# Architecture

## Goals

1. **Never miss a serious call nearby.** Off-duty members with ALS gear in their car should
   know about a structure fire, entrapment or cardiac arrest within minutes-of-driving range,
   even with the phone locked, muted, or in a Focus mode.
2. **One feed, many apps.** The raw FSAS HTML never leaves the ingest layer. Everything
   downstream (this app, the station dashboard, future tools) reads one versioned JSON contract.
3. **Cheap and boring to run.** Free/low-tier services, no servers to patch, batched database
   access, and fail-soft everywhere so the station's own paging is never affected.

## Data flow

```
Pi: IYAFYLv3.py ──(unchanged)──▶ table_bus.publish_table(html)
                 └── publisher/push_to_feed.py ──POST /push (X-Push-Secret, X-Feed-Ts)──▶ Worker
```

**Ingest (`services/api/src/engine/ingest.ts`)**, per push, in exactly three Neon round trips:

1. `SELECT` active incidents for the source (plus any rows whose key reappears).
2. One transaction: `INSERT … ON CONFLICT DO NOTHING RETURNING` for new rows, `UPDATE … RETURNING`
   for rows whose call type / units changed, one bulk `last_seen_at` bump for the rest, and one
   `UPDATE … cleared` for incidents missing from the table for ≥ 20 s.
3. One transaction: all `incident_events` via `unnest`, and the `feed_sources` heartbeat.

Then, off the request path (`ctx.waitUntil`): geocode **alertable** new incidents (cache first,
Google second, bounded to the DC-area bbox) and fan out alerts.

Identity of an incident is `dispatch time | address | box`, the same key sta03's changelog uses,
so code upgrades (HOUSE → UBOX) and unit changes are updates, not new incidents.

**Alerts (`engine/alerts.ts`)**, four round trips regardless of member count:

1. PostGIS candidate query: device's last fix is fresh (`location_max_age_hours`) and within
   `radius_miles`, **or** the member's home point is within its radius; category and minimum
   severity filters applied in SQL.
2. Quiet hours / upgrade opt-outs in TypeScript, then one `INSERT … ON CONFLICT DO NOTHING`
   claiming `(incident, device, kind)` slots — the partial unique index makes paging idempotent
   even when two station pushes race.
3. One Expo Push API call (chunks of 100). iOS payload uses the **critical sound** when both the
   deployment (`ALERTS_CRITICAL_SOUND`) and the device (`critical_alerts_authorized`) allow it,
   otherwise `time-sensitive` interruption level (breaks Focus, respects mute).
4. One transaction to record tickets / errors and disable `DeviceNotRegistered` tokens.

A 15-minute cron checks push receipts, closes incidents unseen for 6 h, and prunes stale location rows.

## Identity and authorization

* **Neon Managed Better Auth** is the identity provider. The app signs in with native Google
  (ID-token flow) or an emailed one-time code, then asks Neon for a short-lived JWT (`/token`).
* The Worker verifies JWTs against the branch's JWKS (`jose`, cached), then resolves the
  **member allowlist** (`members` table). First sign-in by an address in `ADMIN_EMAILS` becomes an
  active admin; everyone else is `pending` until an admin approves them in Settings.
* Server-to-server consumers use hashed **API keys** with scopes `read:feed` / `ingest`.
* Every responder-owned table has **RLS policies** keyed on `auth.user_id()` so the Neon Data
  API can be exposed directly later; the Worker itself uses the owner role and filters by user id.
* Location privacy: only the **latest** fix per device is stored (one row, upserted), fixes older
  than 30 days are deleted, and the app throttles uploads to changes ≥ 200 m / 10 min.

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

## Why these choices

* **Cloudflare Worker over a VM:** the Pi already talks to a Worker; zero ops; free tier is ample.
  The one design constraint (50 subrequests per request on free) is why ingest and alerts batch.
* **Neon over D1/KV:** PostGIS distance queries, RLS, branching for staging, and the auth
  integration the project already standardizes on.
* **Expo push over raw APNs:** Expo's service supports the iOS critical-sound payload, handles
  token rotation and receipts, and keeps the Worker free of HTTP/2 client concerns.
* **Native Google ID-token sign-in over browser redirects:** no deep-link cookie relay is needed,
  so it works with Neon's managed (server-plugin-less) Better Auth. Email codes are the fallback.
