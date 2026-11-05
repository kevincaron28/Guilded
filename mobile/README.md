# Guilded Mobile

Android and iOS share this Expo SDK 58 project. Mobile version **0.2.0**,
Android versionCode **2**, iOS buildNumber **2** are separate from the bot,
addon and Windows companion version. Both store identifiers are
`top.kcaron.guilded`; the Expo slug is `guilded-mobile`.

## Local development

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
