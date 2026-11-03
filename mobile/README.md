# Guilded Mobile

The phone app for Guilded. Android and iOS share one Expo project. It does not
change the shared product version (`package.json` at the repo root stays the
bot, addon and Windows companion version). Store identifiers are
`top.kcaron.guilded` (Android package and iOS bundle id) and the Expo slug
`guilded-mobile`.

## What you can do

**Already in the first local version**

- Home reads the public `GET /leaderboards/summary.json` (this week's season,
  rated runs and guild count).
- Ranks and Profile open the existing website: dungeon leaderboards, guild
  rankings and `/players/`. The website profile button still uses the site's
  own Discord sign-in.

**Added on that app**

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
npm install
npm start
```

Expo Go on a phone can open the QR code when the Expo Go app matches this SDK
(Expo 58). `npm run web` opens the same UI in a browser. `npm run typecheck`
is `tsc --noEmit`.

From the repo root, the phone client is covered by the normal test run
(`npx vitest run mobile/src/api.test.ts`). It does not need Discord or a database.

## Store binaries

The Expo account, Apple Developer Program and Google Play Console are the
owner's. Nothing in this repo signs a store build.

```sh
cd mobile
npx eas-cli login
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

`preview` makes an Android APK and an iOS simulator build for direct installs.
`production` is the existing APK profile. Play Store uploads want an Android
App Bundle, and the App Store wants an iOS store build:

```sh
npx eas-cli build --platform android --profile store
npx eas-cli build --platform ios --profile store
```

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
