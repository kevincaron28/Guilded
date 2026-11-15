# Google Play data safety answers — Guilded

Where to enter them: Play Console → **Policy → App content → Data safety**. These answers come from what the app's code
actually sends, checked again on 14 Nov 2026 against `mobile/src` (the closed-test build, version 0.3.0, without
Guilded Clash). French copy: [play-data-safety.fr.md](play-data-safety.fr.md). Play counts data as
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
| `POST /api/v1/companion/delete-my-data` | the confirm word | Delete my data, after the member confirms on the screen |
| `POST /api/v1/companion/renew` | a new credential | renews the sign-in |
| `POST /api/v1/mobile/device` | the Expo push token, the alert on/off switch and the language | push alerts, only after the member turns alerts on. A bundle built with the `production-no-push` profile has no Firebase, so it never gets a token and never sends this |
| `GET https://u.expo.dev/<project id>` (Expo Updates, once per launch) | the app version, the update channel, the platform and a random installation id the update library makes on the phone (not tied to the account) | fetches a newer JavaScript bundle of the same app version |
| public: `/leaderboards/summary.json`, the leaderboards, `/news/headlines.json` | nothing personal | public data |

Not used: device location (the app has no location permission; positions on the guild map come from the Windows
companion on the member's PC, not the phone), contacts, photos, files, microphone, camera, calendar, analytics, crash
reporting and advertising. No analytics or ads SDK is in `mobile/package.json`. The app's own permissions are `INTERNET` and
`POST_NOTIFICATIONS`; its libraries add more (reminders after a restart, vibration, a messaging component that stays
idle without Firebase, launcher badges). The full list with the reason for each is in
[play-closed-test.md](play-closed-test.md), "Permissions in the bundle". None of them gives access to location, contacts,
photos, the microphone or an advertising ID. `app.json` blocks audio, storage, media and overlay permissions.

## Form answers

**Data collection and security**

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only) |
| Which ways can users request that their data is deleted? | **I provide a way for users to request deletion**. In the app: Me → Settings → **Delete my data** → **Delete everything**. It erases the account and its data on the server through the API and signs the phone out; no website visit is needed. On the web: https://guildedwow.com/delete-my-data/ (public, no sign-in needed to read it; it names the app, gives the steps and says what is deleted and what is kept). The website is retiring its account pages; if its public deletion page gets its own address, use that address here and in `DELETE_INFO_URL` (`mobile/src/links.ts`). |
| Account creation | Users sign in with an account created outside the app (Discord, through the Guilded website). If Console asks for a "Delete account URL", use https://guildedwow.com/delete-my-data/: Google wants a page anyone can read without signing in. |

**Data types.** Tick only these:

| Category → type | Collected | Shared | Processed ephemerally | Required or optional | Purposes |
| --- | --- | --- | --- | --- | --- |
| Personal info → **User IDs** (the companion credential tied to the member's Discord account) | Yes | No | No | Optional (Stats, News and the sample guild work without signing in) | App functionality, Account management |
| App activity → **Other user-generated content** (wishlist items) | Yes | No | No | Optional | App functionality |
| Device or other IDs → **Device or other IDs** (the Expo push token, and the update library's random installation id) | Yes | No | No | Optional for the push token (only when alerts are turned on); the installation id is sent by every installed copy, so if Console makes you choose one, answer **Required** | App functionality (push alerts, app updates) |

Everything else is **not collected**: location, name, email, address, phone, financial info, health, messages, photos,
videos, audio, files, calendar, contacts, web browsing, app interactions, search history, installed apps, crash logs,
diagnostics and other performance data.

**Shared: No** for every type. Guilded's hosting and push providers (Cloudflare, Oracle Cloud, Aiven, Expo push and
Firebase Cloud Messaging) process data on Guilded's behalf. Play does not count service providers as sharing.

**With a `production-no-push` bundle** no push token exists yet. Keep the Device or other IDs row ticked all the
same: it stays true for the update library's installation id, and it saves a second review when push is turned on.

## Update this form when

- crash reporting or analytics is added (Crash logs, Diagnostics);
- the app ever reads the device location (it must not for the guild map: positions come from the game).
