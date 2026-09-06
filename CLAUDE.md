# CLAUDE.md — BarlesChailey

Off-duty firefighter/paramedic alerting for Montgomery County, MD (Rockville VFD).
The station Pi (sta03) pushes the raw FSAS dispatch table here; this repo turns it
into a standardized JSON feed and pages nearby responders on serious calls.

## Layout (npm workspaces, Expo app at the root)

| Path | What |
|---|---|
| `app/`, `src/` | Expo SDK 57 / expo-router iOS app (TypeScript, React Native 0.86, New Architecture) |
| `packages/feed` | `@barleschailey/feed` — feed v1 contract: zod schemas, types, call-type rules (generated from the MCFRS response plans by `scripts/`), `openapi.yaml` |
| `services/api` | `@barleschailey/api` — Cloudflare Worker (Hono) + `BoardState` Durable Object (SQLite): ingest, live board, devices, alert engine, periodic flush to Neon |
| `services/api/migrations` | Postgres schema for Neon (PostGIS + RLS). Statements split by `-- @@` lines |
| `publisher/` | Python drop-in for the Pi: `FeedPublisher.publish(html)` |
| `.eas/workflows` | EAS Workflows: PR checks, staging (develop), production (main), manual API deploy |
| `docs/` | ARCHITECTURE.md (how it works), SETUP.md (Apple/Google/Neon/EAS/Cloudflare steps) |

## Commands

```bash
npm install                 # root; installs all workspaces (.npmrc has legacy-peer-deps)
npm run check               # feed typecheck + api typecheck + api tests + app typecheck + app jest
npm run api:test            # vitest (services/api/test)
npm run api:dev             # wrangler dev (needs services/api/.dev.vars)
npx expo start              # app dev server (needs .env; use a development build, not Expo Go)
eas build -p ios --profile development|preview|production
```

## Conventions

- The feed contract lives in `packages/feed/src/index.ts`. Additive optional fields only within v1.
- `call_type_rules` (DB) is the live source of grading; `packages/feed/src/call-types.ts` and the
  newest `*call_types*.sql` migration must stay identical (`rules-parity.test.ts` enforces it).
  Regenerate both with `packages/feed/scripts/gen_call_types.py` + `write_call_types.py`; never hand-edit.
- Cost discipline: the live feed never touches Postgres. Ingest, feed reads, device/location writes
  and alert matching run inside the Durable Object (`src/board/board-state.ts`, pure logic in
  `src/engine/diff.ts` and `src/engine/match.ts`). Neon is written by the object's alarm
  (`flush()`, one `sql.transaction` every `FLUSH_INTERVAL_MINUTES`) and read on sign-in, preference
  writes, admin actions and `?archive=1`. Keep it that way so Neon's free tier sleeps.
- Auth: the app exchanges its Neon JWT once (`POST /v1/auth/exchange`) for a 30-day HS256 API token
  (`API_TOKEN_SECRET`); `requireUser` verifies API tokens, `authenticateNeon` only the exchange.
- Geocode alertable incidents eagerly, everything else lazily on detail view. Cache by address.
- RPC return types from the Durable Object must be structured-cloneable and non-recursive
  (`JsonValue` in `engine/types.ts` is depth-limited on purpose).
- Never commit secrets: Worker secrets via `wrangler secret put`, app values via EAS environments.
- Timestamps: CAD gives `MM/DD HH:MM:SS` in America/New_York; `lib/time.ts` resolves to UTC.
- Incident identity = dispatch time + address + box (`sourceKey`), mirroring sta03's changelog.py.
- Alerts are idempotent per (incident, device, kind): `INSERT OR IGNORE` claim in SQLite before sending, mirrored by the partial unique index in Postgres.
- iOS critical alerts require Apple's entitlement. `EXPO_PUBLIC_CRITICAL_ALERTS=1` (app) and
  `ALERTS_CRITICAL_SOUND=true` (Worker) are flipped only for builds signed with it.

## Environments

| | Neon branch | Neon Auth | Worker | EAS env / channel |
|---|---|---|---|---|
| dev / staging | `dev` (br-solitary-fire-auv344rd) | ep-solitary-meadow… | `barleschailey-api-staging` | development, preview |
| production | `production` (br-restless-firefly-auoxp084) | ep-floral-night… | `barleschailey-api` | production |

Neon project: `barleschailey` (fragrant-glade-93406829, aws-us-east-1).
