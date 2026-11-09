# Guilded Mobile

Android and iOS share this Expo SDK 58 project. Mobile version **0.2.0**,
Android versionCode **2**, iOS buildNumber **2** are separate from the bot,
addon and Windows companion version. Both store identifiers are
`top.kcaron.guilded`; the Expo slug is `guilded-mobile`.

The phone app for Guilded. Android and iOS share one Expo project. It does not
change the shared product version (`package.json` at the repo root stays the
bot, addon and Windows companion version). Store identifiers are
`top.kcaron.guilded` (Android package and iOS bundle id) and the Expo slug
`guilded-mobile`.

## What you can do

**Five tabs** (redesign slice 3, `docs/plans/APP_REDESIGN.md`):

- **Guild**: sign-in when signed out; then Roster (characters, reserves), Map
  and Raids. The app opens here when signed in.
- **Stats**: this week's summary (`GET /leaderboards/summary.json`) and the
  public leaderboards. Public; the app opens here when signed out.
- **Me**: my characters, badges (album), wishlist, language and sign-out.
- **Alerts**: raid reminders on this phone, plus help-call, dungeon and raid
  vacancy alerts listed as switched off until push lands (PR #345).
- **News**: Wowhead headlines and the Blizzard news link. Public.
- **Guilded Clash** (Me tab, under the badges; `src/clash/`): the collection, free
  packs with crafting, matches against the AI and the PvE gauntlet, from
  `/api/v1/companion/cards` and `/api/v1/companion/clash/*`. Signed out, in the
  sample guild, or on a server without the game, a local sample game runs
  instead (`src/clash/mock.ts`, not the rules engine). Card text comes from
  `src/clash/set1.ts`, generated with `npx tsx mobile/scripts/gen-clash-cards.ts`.
  Art shows a placeholder until each card gets an `artUrl`.
  **Play** has three parts: **Solo** (AI and gauntlet), **Guild** (challenge a guildmate from the roster,
  accept or decline challenges with their expiry, your matches with "Your turn" badges on a 24-hour turn
  clock or live 60-second turns, and the weekly guild board) and **Ranked** (the waiting room, your rank
  and stars this season, the season end, ranked matches in progress, the global and server ladders).
  These use the player-vs-player routes of #644 under `/api/v1/companion/clash/` (`challenge`, `accept`,
  `decline`, `challenge/partners`, `duels`, `duel`, `duel/intent`, `duel/concede`, `ranked`,
  `ranked/join`, `ranked/leave`, `leaderboard`); a duel opens on the same match screen, with
  "Waiting for <name>" on the opponent's turn. The hidden matchmaking rating is never sent to the phone:
  the rank and stars are the visible band.

Signed out, Me and Alerts show a sign-in card. The sample guild fills every tab.
Shared pieces live in `src/ui/`; the signed-in state is `src/useGuild.ts`.

**What each part does**

- **Guild** signs in with the same companion flow as the Windows app. The phone
  calls `POST /api/v1/companion/sign-in`, shows the short code, and opens
  `/me/companion` in the browser. You choose the server there and type the
  code. The phone then polls `POST /api/v1/companion/sign-in/poll`. A
  `/character pair` code still works through `POST /api/v1/addon-pairings`.
  The credential is stored in the device keychain (on the web preview it stays
  in local storage on that browser). The app does not copy the website's
  session cookie.
- **Characters** come from `GET /api/v1/hub`: name, realm, class, spec, level,
  guild rank, and raid-core role.
- **Reserves** are the same hub list. The phone does not write them. Soft
  reserves stay in the game addon; the next officer upload replaces the list.
- **Wishlist** uses `GET` and `POST /api/v1/manage` (`wishlist.set` and
  `wishlist.remove`) for your own characters.
- **Raids** uses `GET /api/v1/standings` (upcoming raids, the next raid's
  roster, EP/GP) and the core boards on `/api/v1/manage`. Signing up stays in
  Discord. Item prices and roster edits stay on the Windows companion.
- **Alerts** are on-device reminders, off until you turn them on. The phone
  schedules a local notification 60 minutes before each upcoming raid it
  already downloaded. There is no push server and no Discord DM. A raid that
  starts inside the hour is shown and not scheduled. Open the app now and then
  so the list stays current.
- **Map** (Track M) uses `GET` and `POST /api/v1/companion/guild-map`: where
  guildmates were last seen outdoors (dots on a plain grid with zone names, no
  game map art), a 28-day heat map of where the guild plays, and calls for help
  from the last six hours with time and attackers. Signed-in members of the
  same guild only, never public. Positions arrive with companion uploads, so
  they are last seen, not live. **Share my position** is on by default; turning
  it off deletes the member's stored positions. Officers: `/officer roster map`.
  Defender push alerts wait for PR #345 (hook: `onHelpCallStored` in
  `src/services/guild-map.ts`).
- **Look at a sample guild** fills those screens with fictional names. It does
  not sign in and does not call the bot.

Desktop-only work stays on the Windows companion: WoW SavedVariables, writing
standings back into the game, and PoE2 `Client.txt`.

The default server is `https://guilded.kcaron.top`. A guild that runs its own
bot can change **Server address** on the sign-in screen, or set
`EXPO_PUBLIC_GUILDED_WEB_URL` before starting Expo. Use https. http is accepted
only for localhost.

## Run it

```sh
cd mobile
npm ci
npm start
npm run typecheck
npx expo install --check
npx expo-doctor
```

`npm run web` provides a browser preview. Use a native development/store build
for device credentials, remote push and verified links; Expo Go does not prove
release notification, app-link, signing or OTA behavior. The default API is
`https://guilded.kcaron.top`; self-hosted guilds can choose an HTTPS server.
HTTP is accepted only for localhost development.

Guild sign-in uses the existing companion approval page and polling API, not
the website cookie. Credentials use SecureStore on native devices. The web
preview stores credentials in that browser, so sign out on shared machines.
Sample mode uses fictional data and must not register devices or send writes.
SavedVariables and PoE2 Client.txt remain Windows companion responsibilities.

## Existing account and project setup

On 4 November 2026, `eas whoami --non-interactive` returned **Not logged in**.
No verified Expo project UUID, Android signing fingerprint or Apple team ID
was available. No account/project was created and no build was submitted.
These are release inputs, not values to guess.

After signing into the owner's actual Expo account, inspect the existing
project with `npx eas-cli project:info`. Use the verified UUID as
`EAS_PROJECT_ID`, and the actual account slug as `EAS_OWNER` if required. Keep
these public identifiers consistent in local build/update and EAS environments.
Set `GOOGLE_SERVICES_JSON` as an EAS **file** environment variable containing
the actual Android Firebase configuration. The config consumes its local path;
Android EAS builds fail if it is missing. Configure FCM V1 service credentials
separately through EAS; never commit either file.

`app.config.js` adds `extra.eas.projectId` and the Expo update URL only when the
UUID is present; native EAS builds fail clearly if it is missing. Local Expo
preview remains usable without it. Never put signing keys, service account
JSON, APNs keys or access tokens in the repository or EXPO_PUBLIC variables.

Discord OAuth still finishes on the existing website callback. The phone is
not a new OAuth client. Configure notification credentials through the actual
EAS project: Android FCM V1 and iOS APNs. The native notifications plugin enables
remote notifications, but that alone does not provide delivery credentials,
backend deployment or end-to-end acceptance. Notifications require explicit
member opt-in.

## Build profiles and versions

| Profile | Android | iOS | OTA channel |
| --- | --- | --- | --- |
| preview | Internal APK | Simulator build | preview |
| device | Internal APK | Physical-device ad hoc build | preview |
| production | Store AAB | App Store build | production |
| store | Alias of production | Alias of production | production |

```sh
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform ios --profile device
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios --profile production
```

Production requires Google Play/App Store accounts and signing. iOS ad hoc
requires registered devices; simulator output cannot install on an iPhone.
There is no automatic submit configuration. Build/submission commands are for
the owner to run after release review; they were not run during preparation.
Before each store upload increase Android versionCode or iOS buildNumber in
`app.json`; update mobile/package.json and expo.version together for a new user
version. Do not bump the repository root version for a mobile-only release.

## OTA updates

The `appVersion` runtime policy accepts updates for the same mobile app version.
A native dependency/config change needs a new native build **and a new app
version** so incompatible updates cannot target old installs. Preview and
production use separate channels. On launch, before interactive screens,
`prepareLaunchUpdate()` checks and fetches a compatible update and reloads only
if the fetched result is new. It runs once per launch, skips development and
web, and disables the duplicate automatic native check.
Network failure keeps the embedded/latest successful update. Without a real
project UUID, OTA stays disabled. Use the same verified EAS project/environment
when building and publishing, and verify on a signed preview build first.

```sh
npx eas-cli update --channel preview --environment preview
npx eas-cli update --channel production --environment production
```

Updates must respect store rules; OTA is not a replacement for native review.
No update was published during preparation.

## App links and website association

Native builds register `guilded://` and the narrow HTTPS path
`https://guilded.kcaron.top/app/*`. OAuth and general website navigation remain
on the website. The Worker gives `/app/raids` and `/app/alerts` a calendar
browser fallback, ranks a leaderboard fallback, and other guild screens a
signed-in profile fallback. Only EN/FR language is forwarded; arbitrary redirect
parameters are ignored.

For verified HTTPS links, configure the website build with public identities
from the real signing accounts:

- `MOBILE_ANDROID_SHA256_FINGERPRINTS`: comma-separated colon-delimited SHA-256
  certificate fingerprints. For Play installs, use the **Play App Signing**
  certificate from Play Console; an upload certificate alone is insufficient.
  Include the preview certificate only if preview links should also verify.
- `MOBILE_APPLE_TEAM_ID`: the actual ten-character Apple team identifier.

`scripts/mobile-associations.mjs` validates these inputs and the site build
emits `/.well-known/assetlinks.json` and/or
`/.well-known/apple-app-site-association`. Missing inputs omit that platform's
file and remove stale output. No placeholder identity is published. Deploy the
website with these inputs, then check both endpoints return HTTP 200 JSON
without authentication or redirects before testing device links. HTTPS link
verification remains pending until this is done; custom schemes need an
installed native app but no association file.

## Release checks still requiring devices/accounts

Confirm sign-in/revocation and guild isolation with real accounts; opt-in,
opt-out, Android permission denial, iOS push and notification taps on physical
devices; verified HTTPS links from another app; offline launch and cached data;
preview OTA installation/rollback; store privacy forms and screenshots; and
release signing/submission. Source/build checks do not establish these results.

Reference: [Expo updates](https://docs.expo.dev/versions/latest/sdk/updates/),
[runtime versions](https://docs.expo.dev/eas-update/runtime-versions/),
[Android app links](https://docs.expo.dev/linking/android-app-links/),
[iOS universal links](https://docs.expo.dev/linking/ios-universal-links/).

`eas.json` keeps `appVersionSource` on `local`. Version and versionCode live
in `app.json` (`0.1.0`, Android `versionCode` 1). Bump those when you ship a
store build. Do not bump the repo root version for a phone-only build: that
version posts a Discord notice from the bot.

Submission (`npx eas-cli submit`) needs the Apple and Google accounts. The
first iOS store build also needs a distribution certificate and a provisioning
profile; EAS can create them when the Apple account is logged in. Google Play
needs a Play App Signing key, which Play Console creates the first time you
upload.

## What the owner still has to do

- **Deploy the website worker** after this change is merged. The public site
  already forwarded sign-in, wishlist and standings. It did not forward
  `GET /api/v1/hub`, so characters, guild rank and reserves 404 until that
  deploy. A self-hosted bot already serves `/api/v1/hub` and needs no worker
  change. Localhost Expo web is also allowed to call the API from the browser
  after the deploy; phone builds do not need that header.
- **Discord OAuth.** No new redirect URI. Sign-in still finishes on
  `https://guilded.kcaron.top/auth/callback`, which is the website's existing
  Discord redirect. The phone never becomes an OAuth client. Remote push is
  off in `app.json` (`enableRemoteNotifications: false`), so an Apple push key
  is not required for the 60-minute reminders.
- **Store accounts and signing**, as above. The app id is `top.kcaron.guilded`
  on both stores. Create the store listings in that name before the first
  upload.
- **A real Discord account** to try the live guild screens. Sample data is
  only a preview.

## Google Play at the lowest cost (plan, 6 November 2026)

Only the owner can do these steps (accounts, payment, identity). Nothing needs Google Cloud OAuth
verification: Guilded signs in with Discord, not Google, and calls no Google API.

1. **Developer account:** play.google.com/console, personal account, one-time **USD 25**. Identity
   verification (government ID) and phone verification are free. Allow a few days.
2. **App listing:** package `top.kcaron.guilded`. Fill in Data safety (what is collected: Discord ID,
   characters, stats; everything is shared, per `docs/PRIVACY.md`), content rating and target audience,
   and link the privacy policy URL on the website.
3. **Closed test:** new personal accounts must run a closed test with **at least 12 testers for 14
   continuous days** before production. Invite Québec Gold members by email or Google Group;
   they install through the Play testing link. Ship the existing EAS build with
   `eas build -p android --profile store` (AAB), then upload it to the closed track.
4. **Production:** after the 14 days, apply for production access in the Console (a short
   questionnaire about the test), then publish. Updates go out through EAS OTA for JS changes
   and new AABs for native changes.
5. **Push notifications** (optional, free): a Firebase project for `top.kcaron.guilded`, the
   `google-services.json` as an EAS file secret, and FCM credentials in EAS. Needed only for
   remote alerts such as calls for help; on-device reminders work without it.

Total cost: USD 25 once. Until then, the free preview APK on GitHub stays available.
