# Setup guide

Everything below is a one-time step you do from your Mac (M4 Pro) with your
Apple developer account (RVFD nonprofit team). Order matters roughly top to bottom.

## 0. Prerequisites

```bash
brew install node@22 watchman
npm install -g eas-cli wrangler neonctl
git clone https://github.com/themeanie3/BarlesChailey && cd BarlesChailey && npm install
```
Xcode 16.1+ with the iOS 18 simulator, and your iPhone 16 Pro in Developer Mode
(Settings → Privacy & Security → Developer Mode).

## 1. Neon (already provisioned)

Project **barleschailey** (`fragrant-glade-93406829`, us-east-1). Two branches, each with its
own auth instance and Data API; the schema in `services/api/migrations/0001_init.sql` is applied to both.

| Branch | Branch id | Auth base URL |
|---|---|---|
| production | `br-restless-firefly-auoxp084` | `https://ep-floral-night-aujf5smv.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth` |
| dev | `br-solitary-fire-auv344rd` | `https://ep-solitary-meadow-aur80hkt.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth` |

Get the connection strings (never commit them):

```bash
neonctl connection-string --project-id fragrant-glade-93406829 --branch production --pooled   # DATABASE_URL (prod)
neonctl connection-string --project-id fragrant-glade-93406829 --branch dev --pooled          # DATABASE_URL (staging)
```

Future schema changes: add `0002_….sql` and run `DATABASE_URL=… npm run migrate -w @barleschailey/api`
against each branch (or `neon` MCP / console SQL editor).

### Google sign-in on Neon Auth

Neon's *shared* Google credentials only work for browser redirects, so the native app needs
your own OAuth client:

1. Google Cloud console → APIs & Services → Credentials → **Create OAuth client**:
   * **Web application** (used by Neon to verify ID tokens). Authorized redirect URI:
     `<Auth base URL>/callback/google` for each branch. Note the client id **and secret**.
   * **iOS** — bundle id `org.rvfd.barleschailey` (production) and `org.rvfd.barleschailey.development` /
     `.preview` (one iOS client per bundle id). Note each client id and its reversed id
     (`com.googleusercontent.apps.…`).
2. Register the Web client on each Neon branch (console → Auth → OAuth → Google, or MCP
   `add_auth_oauth_provider`). This replaces the shared credentials for that branch.
3. Put the ids in the EAS environments (step 4): `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`.

Until this is done the app offers email one-time-code sign-in, which works out of the box.

## 2. Cloudflare Worker

```bash
cd services/api
wrangler login
# staging
wrangler secret put DATABASE_URL --env staging          # dev branch, pooled
wrangler secret put PUSH_SECRET --env staging           # openssl rand -hex 32
wrangler secret put API_KEY_PEPPER --env staging        # openssl rand -hex 32
wrangler secret put GOOGLE_MAPS_API_KEY --env staging   # Geocoding API only, restricted key
# repeat with --env production using the production branch URL
```

Set `ADMIN_EMAILS` in `wrangler.toml` (both envs) to your Google/email address, then:

```bash
npm run deploy:staging      # https://barleschailey-api-staging.<account>.workers.dev
npm run deploy:production   # https://barleschailey-api.<account>.workers.dev
curl https://barleschailey-api-staging.<account>.workers.dev/healthz
```

Optional: `EXPO_ACCESS_TOKEN` secret if you enable "enhanced push security" on expo.dev.
Optional: `DATABASE_AUTHENTICATED_URL` (the `authenticated` role URL from the Neon Data API page)
to have the Worker run user-scoped queries under RLS.

### Point the station at it

On the Pi, copy `publisher/push_to_feed.py` next to `IYAFYLv3.py`, set
`FEED_URL=https://barleschailey-api.<account>.workers.dev/push` and
`FEED_PUSH_SECRET=<PUSH_SECRET>` in its environment (systemd `Environment=` lines), and add two lines
to the scrape loop:

```python
from push_to_feed import FeedPublisher
feed = FeedPublisher()
…
if table_bus.publish_table(html):
    feed.publish_async(html)
```

Check `GET /v1/feed/status` (with an API key) shows `stale: false`.

### API key for the dashboard

```bash
DATABASE_URL=… API_KEY_PEPPER=… npm run create-api-key -w @barleschailey/api -- "sta03 dashboard" read:feed
```
(or Settings is not needed — admins can also `POST /v1/admin/api-keys`).

## 3. Apple

1. **App ID** `org.rvfd.barleschailey` (+ `.development`, `.preview`) with capabilities:
   Push Notifications, Background Modes (Location updates, Remote notifications),
   **Time Sensitive Notifications**. EAS creates these when you run your first build, but the
   Time Sensitive capability must be ticked in the developer portal.
2. **Critical Alerts entitlement** — request at
   <https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/>.
   Suggested justification:

   > BarlesChailey is an internal application for members of the Rockville Volunteer Fire
   > Department (Montgomery County, MD). It notifies off-duty firefighter/paramedics who carry
   > advanced life support equipment about life-threatening emergencies dispatched near their
   > current location: structure fires with occupants trapped, vehicle entrapments, cardiac
   > arrests, shootings/stabbings and technical rescues. A missed or muted notification directly
   > delays patient care; response time in these incidents is measured in minutes. Alerts are
   > sent only for these call types, only to vetted members within a small radius, at most once
   > per incident, and are user-configurable. Typical volume is 0–3 per member per day.

   When approved: enable **Critical Alerts** on the App ID, set `EXPO_PUBLIC_CRITICAL_ALERTS=1`
   in the production EAS environment, set `ALERTS_CRITICAL_SOUND = "true"` in the production
   Worker vars, rebuild, and reinstall (iOS only shows the critical-alert prompt on a fresh install).
3. **App Store Connect**: create the app, note its Apple ID → `eas.json` `submit.production.ios.ascAppId`.
   Create an internal TestFlight group named **RVFD** (used by the production workflow).
4. `eas credentials -p ios` → let EAS manage the distribution cert, push key (APNs .p8) and
   profiles; choose **App Store Connect API key → set up for EAS Submit** so workflows can submit.

## 4. Expo / EAS

```bash
eas login
eas init                       # prints the projectId
```
Put the printed id in the environments as `EAS_PROJECT_ID` (app.config.ts reads it) and set
`EXPO_ACCOUNT_OWNER` to your Expo account/org name.

Create the three environments' variables (dashboard or CLI). Values per environment:

| Name | development | preview | production |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | staging Worker URL | staging Worker URL | production Worker URL |
| `EXPO_PUBLIC_NEON_AUTH_URL` | dev branch auth URL | dev branch auth URL | production auth URL |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | web client | web client | web client |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS dev client | iOS preview client | iOS prod client |
| `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` | reversed id | reversed id | reversed id |
| `EXPO_PUBLIC_CRITICAL_ALERTS` | `0` | `0` | `1` once entitled |
| `EAS_PROJECT_ID`, `EXPO_ACCOUNT_OWNER` | same | same | same |
| `CLOUDFLARE_API_TOKEN` (secret), `CLOUDFLARE_ACCOUNT_ID` (secret) | — | Workers Scripts:Edit token | Workers Scripts:Edit token |

```bash
eas env:set --environment development --name EXPO_PUBLIC_API_URL --value https://… --visibility plaintext
eas env:pull --environment development     # writes .env.local for `npx expo start`
```

Build and run on your phone:

```bash
eas build -p ios --profile development     # installs via QR / TestFlight-less internal distribution
npx expo start --dev-client
```

## 5. CI/CD

* Connect the GitHub repo in the EAS project settings (Project → GitHub) so `.eas/workflows` trigger on push.
* Branch model: `develop` → staging workflow (Worker staging deploy + preview build/OTA);
  `main` → production workflow (Worker production deploy + store build → TestFlight `RVFD` group + OTA).
* PRs run typecheck and tests both on EAS and GitHub Actions.
* OTA updates go out automatically when only JavaScript changed (fingerprint match); native
  changes trigger a new build.

## 6. First run checklist

1. Sign in with the email listed in `ADMIN_EMAILS` (or Google once configured) → you become admin.
2. Accept notifications, then location: choose **Allow While Using**, and when iOS asks again,
   **Change to Always Allow**. Settings shows both as green.
3. Settings → **Send me a test alert**.
4. Settings → **Simulate a house fire near me** (runs the real matcher against your phone).
5. Invite members by email in Settings → Members; they sign in and are approved instantly.
6. Point the Pi at `/push` and watch the Board fill in.

## Troubleshooting

* `pending_approval` on `/v1/me`: your email is not in `ADMIN_EMAILS` and nobody approved you.
* No pushes: check Settings → Permissions; `GET /v1/admin/stats` for `alert_errors_24h`;
  Alerts screen shows the receipt error per alert (`DeviceNotRegistered` → reinstall/re-register).
* Board empty but Pi running: `GET /v1/feed/status` → `stale: true` means `/push` is not
  arriving (wrong URL/secret, Pi firewall — the Pi binds outbound traffic to `wlan0`, set `FEED_IFACE=wlan0`).
* Geocoding failures: incidents show "no map position"; check `GOOGLE_MAPS_API_KEY` and that the
  key allows the Geocoding API; the address cache is in `geocode_cache`.
