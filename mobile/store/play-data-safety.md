# Google Play data safety answers — Guilded

Where to enter them: Play Console → **Policy → App content → Data safety**. These answers come from what the app's code
actually sends, checked again on 26 November 2026 against `mobile/src` (version 0.6.0, without Guilded Clash), and were
**saved in Play Console that day, not yet sent for review**. French copy: [play-data-safety.fr.md](play-data-safety.fr.md).
Play counts data as **collected** when the app sends it off the device. What the app only receives and displays
(guildmates' names, rosters, positions, the activity feed) is not collected by the app, although the Guilded service holds
it. The privacy notice ([docs/PRIVACY.md](../../docs/PRIVACY.md)) covers the service as a whole.

## What the app sends, and where

All of it goes to the Guilded server the member signed in to (default `https://guildedwow.com`), except the update check.
The app refuses `http` addresses except on the device itself (`apiOrigin` in `mobile/src/api.ts`).

| Request | Sends | Why |
| --- | --- | --- |
| `POST /api/v1/companion/sign-in`, `/sign-in/poll` | a random request id | Discord sign-in. The member approves it on the website, in the browser, so the app never sees the Discord password or cookie. |
| `POST /api/v1/addon-pairings` | a pairing code and an optional Discord server id | the alternative sign-in |
| every signed-in request | the companion credential (header `x-companion-credential`), stored in the device keychain (`expo-secure-store`) | identifies the member's account |
| `GET /api/v1/hub`, `/manage`, `/standings`, `/companion/achievements`, `/companion/guild-map`, `/me/characters`, `/me/promotion` | the Discord server id and the language, where the route needs them | reads the member's and the guild's data |
| `GET /api/v1/me/guild-feed` | the server id | reads the guild activity feed (nothing is sent back about it) |
| `POST /api/v1/me/characters/main`, `/unlink` | the character id | the member's own "Make main" and "Unlink" |
| `GET /api/v1/me/raid-signups`, `POST /api/v1/me/raid-signup` | the server id, raid id, answer (I'm in, Maybe, Can't come) and role | the member's own raid sign-up |
| `GET /api/v1/me/crafting` | the server id and the search text | who in the guild can make an item. The server uses the text to answer and does not store it (`src/services/mobile-crafting.ts`) |
| `POST /api/v1/me/craft-request` | the server id, item, quantity, optional note (300 characters at most) and optional character | a craft request, posted for the guild |
| `POST /api/v1/manage` | wishlist edits (item name, priority, character) | the member's raid wishlist |
| `POST /api/v1/companion/guild-map` | `share: true/false` | the member's map-sharing switch (off deletes their positions on the server) |
| `POST /api/v1/companion/logout` | the server id | sign out |
| `POST /api/v1/companion/delete-my-data` | the confirm word | Delete my data, after the member confirms on the screen |
| `POST /api/v1/companion/renew` | a new credential | renews the sign-in |
| `POST /api/v1/mobile/report` | the error text, a short stack with links and file paths removed, the app version, the platform and the screen name; no sign-in, name, token or guild data | **only when a person presses "Send error report"** on the app's error screen after something broke, or **Send** on Me > Settings > Report a problem (0.7.0: a problem or an idea, up to 1,500 characters the person types, with the same version, platform and screen name). Nothing is sent automatically. The server files one bug report and answers a short reference. Rate-limited to five per network per hour |
| `GET`/`POST /api/v1/mobile/device` | the server id, the Expo push token, the alert switches (raids, calls for help, raid spots) and the language | push alerts, only after the member turns alerts on |
| `GET https://u.expo.dev/<project id>` (Expo Updates, once per launch) | the app version, the update channel, the platform and a random installation id the update library makes on the phone (not tied to the account) | fetches a newer JavaScript bundle of the same app version |
| public: leaderboards, weekly summary, raid progress, guild pages, `/news/headlines.json` | nothing personal | public data |

Kept on the phone only (never sent): the app saves the last good boards, news, weekly summary and the signed-in guild
views in the app's private storage (`@react-native-async-storage/async-storage`) so they show offline. The sign-in
credential is not in that storage (it stays in the keychain). Signing out and **Delete my data** erase the guild
snapshots; Android's own "clear storage" erases all of it.

Not used: device location (the app has no location permission; positions on the guild map come from the Windows
companion on the member's PC, not the phone), contacts, photos, files, microphone, camera, calendar, analytics SDKs,
automatic crash reporting and advertising. No analytics or ads SDK is in `mobile/package.json`. The app's own permissions
are `INTERNET` and `POST_NOTIFICATIONS`; its libraries add more (reminders after a restart, vibration, push messaging,
launcher badges). The list with the reason for each is in [play-closed-test.md](play-closed-test.md), "Permissions in the
bundle". None of them gives access to location, contacts, photos, the microphone or an advertising ID. `app.json` blocks
audio, storage, media and overlay permissions.

## Form answers

**Data collection and security**

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only) |
| Account creation | **OAuth**: users sign in with an account created outside the app (Discord, through the Guilded website). |
| Delete account URL | https://guildedwow.com/delete-my-data/: Google wants a page anyone can read without signing in. It names the app, gives the steps and says what is deleted and what is kept. In the app: Me → Settings → **Delete my data** → **Delete everything**, which erases the account and its data on the server through the API and signs the phone out. The website is retiring its account pages; if its public deletion page gets its own address, use that address here and in `DELETE_INFO_URL` (`mobile/src/links.ts`). |

**Data types.** Tick only these six:

| Category → type | What it covers | Collected | Shared | Processed ephemerally | Required or optional | Purposes |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info → **User IDs** | the companion credential tied to the member's Discord account | Yes | No | No | Optional (Stats, News and the sample guild work without signing in) | App functionality, Account management |
| App activity → **Other user-generated content** | wishlist items, the note on a craft request, the text of a Report a problem (0.7.0) | Yes | No | No | Optional | App functionality |
| App activity → **Other actions** | raid answers, craft requests, Make main and Unlink, the map-sharing switch | Yes | No | No | Optional | App functionality |
| App activity → **In-app search history** | the crafting search text | Yes | No | **Yes** (so Play does not show it on the listing) | Optional | App functionality |
| App info and performance → **Crash logs** | only the error report a person sends from the error screen | Yes | No | No | Optional (a button the person presses; nothing is sent automatically) | App functionality, Analytics (Play's "Analytics" includes diagnosing crashes) |
| Device or other IDs → **Device or other IDs** | the Expo push token and the update library's random installation id | Yes | No | No | **Required**: the installation id is sent at every launch (the push token only when alerts are on) | App functionality (push alerts, app updates) |

Everything else is **not collected**: location, name, email, address, phone, financial info, health, messages, photos,
videos, audio, files, calendar, contacts, web browsing, app interactions, installed apps, diagnostics and other
performance data.

**Shared: No** for every type. Guilded's hosting and push providers (Cloudflare, Oracle Cloud, Expo push and Firebase
Cloud Messaging) process data on Guilded's behalf. Play does not count service providers as sharing.

## Update this form when

- a screen starts sending something new to the server;
- automatic crash reporting or analytics is added (the error report is manual and already declared as Crash logs);
- the app ever reads the device location (it must not for the guild map: positions come from the game).
