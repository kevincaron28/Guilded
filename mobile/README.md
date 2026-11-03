# Guilded Mobile

The first mobile client for Guilded, built as an isolated Expo app so it does
not change the bot, addon, companion, website release, or shared product
version. Android and iOS use the same React Native codebase.

## What is connected today

- The home screen reads the existing public endpoint at
  `/leaderboards/summary.json` for this week's Guilded activity.
- Leaderboard and profile actions open the existing website routes. Discord
  OAuth and private profile controls remain website-only until a native session
  flow is designed and supported by the backend.
- The app uses the live Guilded web origin by default. To point at another
  environment, set `EXPO_PUBLIC_GUILDED_WEB_URL` before starting Expo.

The repository's real backend is the existing TypeScript bot and Worker-backed
website with PostgreSQL persistence. It already owns Discord sign-in, session
cookies, public leaderboard data and player profiles. This app reuses those
public surfaces and does not create a second database, scoring engine or login
system.

## Run locally

```sh
npm install
npm start
```

Expo Go can open the development QR code on an Android or iOS device. Android
APK builds can be made with an authenticated EAS CLI account:

```sh
npx eas-cli build --platform android --profile preview
```

The `preview` and `production` EAS profiles both produce APKs for direct
distribution. The initial setup does not require a store listing. iOS native
distribution still requires Apple's signing and distribution program; the
existing website remains accessible on iOS in the meantime.

## Roadmap

1. Keep public read-only community screens on the current website data.
2. Add native Discord sign-in only after the backend supports a mobile OAuth
   flow (authorization code with PKCE, app redirect and revocable mobile
   credentials); never copy browser session cookies into the app.
3. Add authenticated character and guild views through scoped API responses,
   preserving guild permissions and profile privacy.
4. Add push notifications only with explicit user opt-in and a documented
   delivery preference.
