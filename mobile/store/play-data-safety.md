# Google Play data safety answers — Guilded

Where to enter them: Play Console → **Policy → App content → Data safety**. These answers come from what the app's code
actually sends, checked on 8 Nov 2026 against `mobile/src` on `main` plus PR #345 (`release/mobile-launch`). The Play
build must include #345, because the production profile needs its Firebase push setup. Play counts data as
**collected** when the app sends it off the device. What the app only receives and displays (guildmates' names, rosters,
positions) is not collected by the app, although the Guilded service holds it. The privacy notice
([docs/PRIVACY.md](../../docs/PRIVACY.md)) covers the service as a whole.

## What the app sends, and where

All of it goes to the Guilded server the member signed in to (default `https://guildedwow.com`). The app refuses
`http` addresses except on the device itself (`apiOrigin` in `mobile/src/api.ts`).

| Request | Sends | Why |
| --- | --- | --- |
| `POST /api/v1/companion/sign-in`, `/sign-in/poll` | a random request id | Discord sign-in. The member approves it on the website, in the browser, so the app never sees the Discord password or cookie. |
| `POST /api/v1/addon-pairings` | a pairing code and an optional Discord server id | the alternative sign-in |
| every signed-in request | the companion credential (header `x-companion-credential`), stored in the device keychain (`expo-secure-store`) | identifies the member's account |
| `GET /api/v1/hub`, `/manage`, `/standings`, `/companion/achievements`, `/companion/guild-map` | the Discord server id and the language | reads the guild's data |
| `POST /api/v1/manage` | wishlist edits (item name, priority, character) | the member's raid wishlist |
| `POST /api/v1/companion/guild-map` | `share: true/false` | the member's map-sharing switch (off deletes their positions on the server) |
| `POST /api/v1/companion/logout` | the server id | sign out |
| `POST /api/v1/companion/renew` (#345) | a new credential | renews the sign-in |
| `POST /api/v1/mobile/device` (#345) | the Expo push token, the alert on/off switch and the language | push alerts, only after the member turns alerts on |
| public: `/leaderboards/summary.json`, the leaderboards, `/news/headlines.json` | nothing personal | public data |

Not used: device location (the app has no location permission; positions on the guild map come from the Windows
companion on the member's PC, not the phone), contacts, photos, files, microphone, camera, calendar, analytics, crash
reporting and advertising. No analytics or ads SDK is in `mobile/package.json`. The permissions are `INTERNET` and
`POST_NOTIFICATIONS`. #345 blocks audio, storage, media and overlay permissions.

## Form answers

**Data collection and security**

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only) |
| Which ways can users request that their data is deleted? | **I provide a way for users to request deletion**: the web link https://guildedwow.com/me/data (Delete my data). The companion API also exposes `POST /api/v1/companion/delete-my-data`, but the phone has no button for it yet. |
| Account creation | Users sign in with an account created outside the app (Discord, through the Guilded website). For the account-deletion link, use https://guildedwow.com/me/data. |

**Data types.** Tick only these:

| Category → type | Collected | Shared | Processed ephemerally | Required or optional | Purposes |
| --- | --- | --- | --- | --- | --- |
| Personal info → **User IDs** (the companion credential tied to the member's Discord account) | Yes | No | No | Optional (Stats, News and the sample guild work without signing in) | App functionality, Account management |
| App activity → **Other user-generated content** (wishlist items) | Yes | No | No | Optional | App functionality |
| Device or other IDs → **Device or other IDs** (the Expo push token, #345) | Yes | No | No | Optional (only when alerts are turned on) | App functionality (push alerts) |

Everything else is **not collected**: location, name, email, address, phone, financial info, health, messages, photos,
videos, audio, files, calendar, contacts, web browsing, app interactions, search history, installed apps, crash logs,
diagnostics and other performance data.

**Shared: No** for every type. Guilded's hosting and push providers (Cloudflare, Oracle Cloud, Aiven, Expo push and
Firebase Cloud Messaging) process data on Guilded's behalf. Play does not count service providers as sharing.

## Update this form when

- the phone gets a **Delete my data** button (change the deletion answer to "in the app and on the web");
- crash reporting or analytics is added (Crash logs, Diagnostics);
- the app ever reads the device location (it must not for the guild map: positions come from the game).
