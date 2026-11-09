# Android: Google Play launch (owner steps)

Written 8 November 2026. The developer account is paid; the owner finished identity, device and phone verifications on 9 November 2026. On that day the Play Console showed no app yet (Create app asks for the three declarations in step 4). Menu names are Play
Console's and Firebase's as of November 2026. If a label has moved, look for the same words nearby.
Agents must not create accounts, sign in for the owner, or change store ids (`top.kcaron.guilded`) or EAS settings.

**Ready in the repo:**
- [mobile/store/play-listing.md](../mobile/store/play-listing.md): texts (EN/FR), category, URLs and graphics
- [mobile/store/play-data-safety.md](../mobile/store/play-data-safety.md): the data-safety answers
- [mobile/store/play-content-rating.md](../mobile/store/play-content-rating.md): the questionnaire, target audience and app access answers
- `mobile/store/screenshots/` (7 at 1080 × 1920) and `mobile/store/feature-graphic-1024x500.png`

**Before anything is uploaded:** merge PR #345 (push, sign-in renewal, icons, production build profile) and PR #615
(five tabs). The listing and screenshots describe that build. PowerShell blocks plain `npx` on this PC, so use
`npx.cmd`. The Expo account `kevincaron28` and the EAS project (`ddda073f-…`) already exist.

## 1. Firebase project (push notifications)

1. Open https://console.firebase.google.com and sign in with the Google account that will own the app.
2. **Create a project** → name `Guilded` → Continue → turn **off** "Enable Google Analytics for this project" (the app
   has no analytics) → **Create project** → Continue.
3. On the project home, click the **Android** icon ("Add app").
   - Android package name: `top.kcaron.guilded` (exactly).
   - App nickname: `Guilded Android`. Leave the SHA-1 empty.
   - **Register app**.
4. **Download google-services.json** and save it outside the repo (for example `Documents\guilded-secrets\`). Never
   commit it. Click **Next**, **Next** and **Continue to console**; skip the Gradle steps, because Expo does them.
5. Gear icon → **Project settings** → **Service accounts** tab → **Generate new private key** → **Generate key**.
   Keep that JSON file next to the other one. It lets Expo send pushes (FCM v1). Never commit it.

## 1b. EXPO_TOKEN (automatic phone updates from GitHub)

Optional but wanted: `.github/workflows/mobile-update.yml` publishes JavaScript-only updates when main changes `mobile/`, once this secret exists. It never builds an APK.

1. Open https://expo.dev, sign in as `kevincaron28`, click your account name (top right) → **Access tokens** (https://expo.dev/accounts/kevincaron28/settings/access-tokens).
2. **Create token** → name `github-actions` → **Create**. Copy the token now: Expo shows it once.
3. Open https://github.com/kevincaron28/Guilded/settings/secrets/actions → **New repository secret**.
4. Name: `EXPO_TOKEN` (exactly). Secret: paste the token → **Add secret**.
5. Done. Never paste the token in chat or commit it. To revoke it later, delete it on the Expo access tokens page.

## 2. Give both files to EAS (from `mobile\` on the PC)

```bash
npx.cmd eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value "C:/Users/Kev/Documents/guilded-secrets/google-services.json" --environment production --visibility secret
```

```bash
npx.cmd eas-cli credentials -p android
```

In the menu: **production** → **Google Service Account** → **Manage your Google Service Account Key for Push
Notifications (FCM V1)** → **Set up** → **Upload a new service account key** → pick the private-key JSON from step 1.5.

`mobile/app.config.js` (from #345) reads `GOOGLE_SERVICES_JSON`, and refuses a production Android build without it.

## 3. Build the Play bundle

```bash
npx.cmd eas-cli build -p android --profile production
```

This produces an `.aab` (app bundle) on expo.dev. Download it when the build finishes. Before every later upload, bump
`android.versionCode` in `mobile/app.json`: Play refuses a number it has seen. That is a reviewed PR, not an agent's
side change.

## 4. Create the app in Play Console

1. https://play.google.com/console → **Create app**.
2. App name `Guilded`, default language **English (United States)**, **App**, **Free**. Tick the two declarations
   (Developer Program Policies, US export laws) → **Create app**.

## 5. Policy → App content (left menu)

Answer each card with the files in `mobile/store/`:

| Card | Where the answers are |
| --- | --- |
| Privacy policy | `https://guilded.kcaron.top/docs/PRIVACY` |
| App access | "All or some functionality is restricted" → add instructions: the text in play-content-rating.md (sample guild) |
| Ads | No ads |
| Content ratings | play-content-rating.md → category **All Other App Types** |
| Target audience and content | 13–15, 16–17, 18+ |
| News apps | No |
| Data safety | play-data-safety.md |
| Government apps, Financial features, Health | No / none |

Each card needs **Save**, and some need **Submit**. The dashboard ticks them off.

## 6. Store listing

**Grow users → Store presence → Main store listing**:
1. App name, short and full description: the English blocks in play-listing.md.
2. App icon: 512 × 512 PNG exported from `mobile/assets/icon.png` (#345).
3. Feature graphic: `mobile/store/feature-graphic-1024x500.png`.
4. Phone screenshots: the seven files in `mobile/store/screenshots/`, in number order.
5. **Save**.
6. **Manage translations → Add your own translation text → French (Canada) – fr-CA** → paste the French blocks →
   **Save**. The same graphics are fine for French.
7. **Store settings**: Category **Social**, contact email (the placeholder in play-listing.md: pick a support
   address), website `https://guilded.kcaron.top` → **Save**.

## 7. Closed test: at least 12 testers for 14 days (required for new personal accounts)

1. **Test and release → Testing → Closed testing** → **Create track** (or use the default "Closed testing - Alpha").
2. **Testers** tab → **Create email list** → name `Guild testers` → add at least **12** Google-account emails (more is
   safer: the 12 must stay opted in for the whole 14 days) → **Save** → tick the list → **Save changes**. Add a
   feedback email or URL.
3. **Releases** → **Create new release** → accept **Play App Signing** the first time → upload the `.aab` from step 3
   → release name `0.3.0 (closed test)` → release notes (EN and FR) → **Next** → fix any warnings → **Save** → **Go to
   Publishing overview** → **Send for review**.
4. Once it is approved, copy the **opt-in link** (Testers tab, "How testers join your test") and post it in the
   guild's Discord. Each tester opens it on their Android phone, taps **Become a tester**, then installs Guilded from
   the Play link.
5. Countries: the track's **Countries / regions** tab, at least Canada (add others as needed).
6. Wait **14 days** with 12 or more testers opted in. The dashboard counts the days. Update the build during the test
   as often as needed (bump the `versionCode`).

## 8. Production

1. When the dashboard says the requirement is met: **Dashboard → Apply for production**. Answer the questions about
   the test (who tested, what feedback, what changed). Review usually takes about 7 days.
2. After approval: **Test and release → Production** → **Create new release** → **Add from library** (the tested
   bundle) → release notes → **Next** → **Countries / regions** → **Save** → **Send for review**.
3. When it is live: update `site/releases.json` (`mobile.android`) and `/companion/` so they point at the Play listing
   instead of the GitHub APK (a site PR, done by an agent).

## Later

- Each new version: bump `version` and `versionCode` in `mobile/app.json` (a PR), run the build in step 3, then
  upload it to Production (or a test track first).
- Optional: `eas submit -p android` can upload builds after the first manual one. It needs a Play service account
  with release permissions (Play Console → Users and permissions → Invite new users, using the service account
  email).
