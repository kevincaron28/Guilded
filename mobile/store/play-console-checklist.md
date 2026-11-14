# Play Console checklist: closed test with Testers Community

Written 14 November 2026. French copy: [play-console-checklist.fr.md](play-console-checklist.fr.md). Longer notes on
each Console screen: [docs/ANDROID_PLAY_LAUNCH.md](../../docs/ANDROID_PLAY_LAUNCH.md).

**Who does what.** "Owner" means Kevin himself: a sign-in, a password, a 2FA code, an identity or payment detail, a
declaration tick, a credential file, or a public action. "Agent" means the master session or a worker can do it,
after the owner's yes where the step says so. An agent stops at any sign-in page, CAPTCHA, new terms or paid plan.

Menu names are Play Console's as of November 2026. If a label has moved, look for the same words nearby.

## Before starting

| # | Step | Who |
| --- | --- | --- |
| 0.1 | The Android launch pull request is merged, and CI is green on `main`. | Agent (master merges) |
| 0.2 | Decide the app name (see "App name" in [play-listing.md](play-listing.md)). | **Owner** |
| 0.3 | Decide push or no push for this first bundle. **No push** (recommended for the closed test): nothing to set up, build with `production-no-push`. **Push**: do the Firebase steps 1 and 2 of ANDROID_PLAY_LAUNCH.md first (Google sign-in, two credential files kept in `Documents\guilded-secrets\`), then build with `production`. | **Owner** decides; Firebase is **Owner** |

## 1. Build the bundle (.aab)

Run from `mobile\` in the main checkout on the owner's PC, on `main` after the merge. PowerShell blocks plain `npx`
on this PC: use `npx.cmd`.

| # | Step | Who |
| --- | --- | --- |
| 1.1 | Install the dependencies: `npm.cmd ci` in `mobile\` (the main checkout, never a worktree that has a `node_modules` junction). | Agent |
| 1.2 | Check the Expo sign-in: `npx.cmd eas-cli whoami` must answer `kevincaron28`. If it does not: `npx.cmd eas-cli login`. | **Owner** types the password if a login is needed |
| 1.3 | Start the build: `npx.cmd eas-cli build --platform android --profile production-no-push` (or `--profile production` with Firebase). | Agent, after the owner's yes for 1.4 |
| 1.4 | The first store build asks **"Generate a new Android Keystore?"** Answer **Yes**. This creates the upload key and keeps it in the owner's Expo account. Nothing is downloaded and no key file is put in the repository. | **Owner's yes** (a signing key is created) |
| 1.5 | Wait for the build on expo.dev (about 15 minutes), then download the `.aab` from the build page to `Documents\guilded-secrets\builds\` (not into the repository). | Agent |
| 1.6 | Note the build page address, the versionCode (3) and the file's SHA-256 in the release acceptance notes. | Agent |

If the build fails with "Production Android builds require the Firebase GOOGLE_SERVICES_JSON…", the profile was
`production` without Firebase: use `production-no-push`.

## 2. Create the app

| # | Step | Who |
| --- | --- | --- |
| 2.1 | https://play.google.com/console → **Create app**. | **Owner** (signed in) |
| 2.2 | App name (0.2), default language **English (United States) – en-US**, **App**, **Free**. | Agent may type; **Owner** checks |
| 2.3 | Tick the declarations (Developer Program Policies, US export laws) → **Create app**. | **Owner** |

The package name `top.kcaron.guilded` is fixed for ever by the first uploaded bundle. It cannot be changed later.

## 3. App content (Policy → App content)

Every card needs **Save**; some need **Submit**. The answers are ready:

| Card | Answer | Who |
| --- | --- | --- |
| Privacy policy | `https://guildedwow.com/docs/PRIVACY` | Agent types, **Owner** saves |
| App access | "All or some functionality is restricted" → instructions from [play-content-rating.md](play-content-rating.md) (sample guild; no test account) | Agent types, **Owner** saves |
| Ads | No ads | **Owner** |
| Content ratings | [play-content-rating.md](play-content-rating.md): category **All Other App Types**; the email is `support@guildedwow.com` | Agent types, **Owner** submits |
| Target audience and content | 13–15, 16–17, 18 and over; no appeal to children | **Owner** |
| News apps | No | **Owner** |
| Data safety | [play-data-safety.md](play-data-safety.md), row by row | Agent types, **Owner** submits |
| Government apps, Financial features, Health | No / none | **Owner** |
| Advertising ID | **No**, the app does not use an advertising ID | **Owner** |

## 4. Store listing (Grow users → Store presence → Main store listing)

| # | Step | Who |
| --- | --- | --- |
| 4.1 | App name, short and full description: the English blocks of [play-listing.md](play-listing.md). | Agent types |
| 4.2 | Icon `icon-512.png`, feature graphic `feature-graphic-1024x500.png`, the seven phone screenshots in number order ([play-screenshots.md](play-screenshots.md)). | Agent uploads |
| 4.3 | **Save**. Then **Manage translations → Add your own translation text → French (Canada) – fr-CA**, paste the French blocks, **Save**. | Agent types, **Owner** checks the French |
| 4.4 | **Store settings**: category **Social**, email `support@guildedwow.com`, website `https://guildedwow.com` → **Save**. Check first that a message sent to that address reaches the owner. | **Owner** |

## 5. Closed testing track

| # | Step | Who |
| --- | --- | --- |
| 5.1 | **Test and release → Testing → Closed testing** → use the default track ("Closed testing - Alpha") → **Manage track**. | Agent |
| 5.2 | **Countries / regions** tab → **Add countries / regions** → select **all** countries → **Save**. Testers Community's testers are in many countries; a tester whose country is missing sees "app not available". | Agent |
| 5.3 | **Testers** tab → under **Google Groups**, add the Testers Community group address (step 6.1). Do not use "Email lists" for it. Add a feedback address: `support@guildedwow.com`. **Save**. | Agent types the address the owner confirmed |
| 5.4 | Optional: a second Google Group or an email list for guild members who want to test. | **Owner** |
| 5.5 | **Releases** tab → **Create new release** → accept **Play App Signing** (Google creates and keeps the app signing key) → upload the `.aab` → release name `0.3.0 (closed test)` → release notes from [play-closed-test.md](play-closed-test.md) → **Next** → fix any error → **Save**. | **Owner** accepts Play App Signing; Agent uploads |
| 5.6 | **Publishing overview** → **Send changes for review**. This is the public action: it sends the app to Google. | **Owner's yes** |
| 5.7 | Wait for Google's review (a few hours to a few days for a first release). The track must say the release is **available to testers**, not "in review" or "draft". | — |
| 5.8 | Testers tab → **How testers join your test** → copy both links: the web opt-in link (`https://play.google.com/apps/testing/top.kcaron.guilded`) and the Play link (`https://play.google.com/store/apps/details?id=top.kcaron.guilded`). | Agent |

## 6. Testers Community

What their public pages say (read on 14 November 2026; they are the vendor's own statements):

- The requirement they cover: a closed test with at least 12 testers opted in for 14 days in a row, for personal
  developer accounts created after 13 November 2023
  ([Google's own page](https://support.google.com/googleplay/android-developer/answer/14151465)).
- The developer adds **their testers' Google Group** to the closed track, under "Google Groups" and not "Email
  lists", selects all countries, then saves, sends for review and publishes
  ([enterprise onboarding guide](https://testerscommunity.com/guides/enterprise-onboarding),
  [how it works, in the dashboard](https://www.testerscommunity.com/dashboard/guides/how-testers-community-works)).
  The group address shown in search results for their guide is `testers-community@googlegroups.com`. **Confirm it on
  the dashboard page before typing it**: the dashboard is behind the owner's sign-in.
- The app is submitted at https://www.testerscommunity.com/submit-app with the closed-testing links
  ([what is Testers Community](https://testerscommunity.com/blog/what-is-testers-community)).
- Testers opt in within about 6 hours of a published test, stay for the whole period, and a report comes at the end.
  The paid plans promise production access or the money back; the conditions are in their refund policy, which the
  owner should read before spending the credit.
- Their pages do not say whether the app must be free, and do not list what the developer must avoid during the 14
  days. Google's rule answers the second point: a tester who leaves and comes back starts again at day 1.

| # | Step | Who |
| --- | --- | --- |
| 6.1 | Sign in at testerscommunity.com, open the dashboard guide and read the exact Google Group address and any newer instruction. Tell the master the address. | **Owner** |
| 6.2 | After 5.7 says "available to testers": submit the app at https://www.testerscommunity.com/submit-app with the two links of 5.8, the Pro credit, and the tester note from [play-closed-test.md](play-closed-test.md). This starts the order: a public action that spends the credit. | **Owner** |
| 6.3 | The same day, check in Play Console (Closed testing → Testers) that the tester count rises to 12 or more. If it stays at 0, the usual causes are: changes not saved, review not sent, or the release not yet approved. | Agent reads, **Owner** signed in |
| 6.4 | For 14 days: do not remove the group, do not pause or delete the track, do not unpublish the app, do not change the countries. New builds are allowed (higher versionCode, same track). Answer what the testers report. | Everyone |
| 6.5 | Keep the feedback: Testers Community's report and anything sent to the support address. Google asks about it in step 7. | Agent |

## 7. After 14 days: apply for production

| # | Step | Who |
| --- | --- | --- |
| 7.1 | Play Console **Dashboard** → when it says the testing requirement is met → **Apply for production**. | **Owner** |
| 7.2 | Answer the three parts: about the closed test (how testers were recruited, what they used, the feedback and how it was collected), about the app (audience, what it is for, expected installs in the first year), about production readiness (what changed after the test). An agent drafts the answers from the report; the owner reads and submits. Review usually takes seven days or less. | Agent drafts, **Owner** submits |
| 7.3 | After approval: **Production** → **Create new release** → **Add from library** → release notes → countries → **Send for review**. | **Owner's yes** |

## Not needed for the closed test, to do before production

- App links: once Play App Signing exists, copy the app signing certificate's SHA-256 (Play Console → Test and
  release → Setup → App signing) into the site build variable `MOBILE_ANDROID_SHA256_FINGERPRINTS`, and redeploy the
  site and its Worker so `https://guildedwow.com/.well-known/assetlinks.json` answers. Until then a
  `guildedwow.com/app/...` link opens the browser, which is harmless. The fingerprint is public, not a secret.
- Push: Firebase and the server side (the bot's `mobile_devices` tables arrive with the same pull request and need a
  bot deploy).
- `EXPO_TOKEN` in GitHub for automatic JavaScript updates (ANDROID_PLAY_LAUNCH.md, step 1b). Owner creates the token.
- Point `site/releases.json` and `/companion/` at the Play listing once the app is public.
