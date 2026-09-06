# BarlesChailey

Off-duty dispatch alerting for Rockville Volunteer Fire Department members in
Montgomery County, MD. The station's existing FSAS scraper pushes the raw
dispatch table to a small cloud API; the API turns it into a **standardized
JSON feed** any app can consume, and pages nearby members on serious calls
(structure fires, entrapments, cardiac arrests, shootings…) using their phone's
background location.

```
 Station Pi (sta03)          Cloudflare Worker (services/api)             iPhone (Expo app)
 ─────────────────           ─────────────────────────────────            ────────────────
 scrape FSAS 10x/s  ──HTML──▶ Durable Object: parse → diff → classify ──JSON──▶ live board
 (unchanged code)             → geocode → match devices ──Expo push──▶ 🔔 critical / time-sensitive
                              ↓ flushed every 30 min                       ↑ background fix
                              Neon Postgres + PostGIS (history, auth, RLS)
```

| Piece | Where | Stack |
|---|---|---|
| Feed contract (v1) | `packages/feed` | zod + TypeScript, `openapi.yaml` |
| Ingest, feed API, alert engine | `services/api` | Cloudflare Worker + Durable Object (SQLite), Hono, Neon serverless driver, jose |
| Database + auth | Neon | Postgres 17, PostGIS, RLS, Managed Better Auth (Google + email code) |
| iOS app | repo root (`app/`, `src/`) | Expo SDK 57, expo-router, React Native 0.86 |
| CI/CD | `.eas/workflows`, `.github/workflows` | EAS Workflows (build, update, TestFlight, Worker deploy), GitHub Actions gate |
| Station bridge | `publisher/push_to_feed.py` | 40-line drop-in for the Pi |

## Quick start (developer)

```bash
npm install                                  # everything (root + workspaces)
npm run check                                # typecheck + tests for feed, api, app
cp services/api/.dev.vars.example services/api/.dev.vars   # fill in
npm run api:dev                              # Worker on http://localhost:8787
cp .env.example .env                         # fill in
eas build -p ios --profile development       # dev client (background location needs a real build)
npx expo start --dev-client
```

Full setup (Apple entitlements, Google OAuth, Neon secrets, EAS environments,
Cloudflare deploy, pointing the Pi at the API) is in **[docs/SETUP.md](docs/SETUP.md)**.
How the pieces fit and why is in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Consuming the feed from another app

Every consumer speaks the same contract:

```bash
# server-to-server (dashboard, scripts)
curl -H "X-Api-Key: bck_…" https://barleschailey-api.<acct>.workers.dev/v1/incidents
# signed-in member: exchange the Neon Auth JWT once, then use the 30-day API token
curl -X POST -H "Authorization: Bearer <Neon Auth JWT>" …/v1/auth/exchange
curl -H "Authorization: Bearer <API token>" …/v1/incidents?since=2026-09-06T00:00:00Z
```

See `packages/feed/openapi.yaml` (also served at `/v1/openapi.yaml`) and the
TypeScript types in `packages/feed/src/index.ts`.

## Cost envelope

$0/month by design. Cloudflare Workers and the Durable Object stay on the free
tier (well under 100k requests/day, 1–3 ms CPU per request, a few thousand
SQLite writes/day). Neon stays on its free tier because the live feed runs
entirely inside the Durable Object and Postgres only wakes for a batched flush
every 30 minutes, sign-ins and admin actions (~30–60 of the free 100
compute-hours/month). Google geocoding stays in its free 10k/month because only
alertable calls are geocoded eagerly. Expo push is free.
