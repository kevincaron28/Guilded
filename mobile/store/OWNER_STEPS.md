# Owner steps: Play closed test and Testers Community

Written 14 November 2026. These are only the steps Kevin must do himself, in order, with where to click and what to
have ready. Everything else (typing the listing, uploading images, starting the build, reading results) can be done
by an agent once he says so. The full list with both kinds of steps is
[play-console-checklist.md](play-console-checklist.md) (French: [play-console-checklist.fr.md](play-console-checklist.fr.md)).

An agent never types a password, a 2FA code, an identity or payment detail, and stops at any sign-in page, CAPTCHA,
new terms or paid plan.

## Decided on 15 November 2026

**Decided by the owner on 15 November 2026:** the Play name is **`Guild Sync Companion`**, the label under the
phone icon stays `Guilded`, and the first bundle goes out **without push** (profile `production-no-push`).
The two sections below are kept for the record.

## Decide first (no clicking)

### 1. The app's name on Play

| Option | For | Against |
| --- | --- | --- |
| 1. `Guild Sync Companion` | The name the Microsoft Store already accepted for the Windows companion: one name on both stores, and no clash with the other "Guilded" on Play. | Members who search "Guilded" will not find it by name; the header inside the app and the website still say Guilded. |
| 2. `Guild Sync` | Same family as the Store name, shorter, and fits a phone app that shows the guild instead of uploading for it. | A new name that is used nowhere else yet; a little generic, so check that Play has no app of that exact name before choosing it. |
| 3. `Guilded: guild companion` | Keeps the name members know and says what the app is. Search still finds "Guilded". | Still starts with the other product's name, so Play can refuse it or act on a complaint later; a forced rename after launch costs a new review. |

Chosen: **1**, because it is already accepted elsewhere and cannot be confused with the other app. Plain
`Guilded` is not proposed: another app of that name is on Play. The package id (`top.kcaron.guilded`) and the name
under the icon on the phone (`Guilded`) stay the same whichever is chosen.

### 2. Push alerts in the first bundle, or not

- **Without push (recommended for the closed test):** nothing to set up. Raid reminders are still scheduled on the
  phone. Skip step 3.
- **With push:** needs a Firebase project (step 3), the server pull request deployed on the bot, and about ten more
  minutes.

## Then, in order

| # | What | Where to click | Have ready |
| --- | --- | --- | --- |
| 3 | Not needed: the first bundle has no push. (Firebase is already set up in the Expo account for a later bundle with push.) | — | — |
| 4 | Done: Expo is signed in on the PC as `kevincaron28` (checked 15 November). | — | — |
| 5 | Done: the upload key already existed in the Expo account (created with the earlier builds), so the store builds of 15 November reused it and created nothing. The bundle to upload is the `production-no-push` one, version 0.3.0. | The build page on expo.dev shows its versionCode. | — |
| 6 | Create the app. | https://play.google.com/console → **Create app** → name `Guild Sync Companion`, **English (United States)**, **App**, **Free** → tick both declarations → **Create app**. | The Play Console sign-in. The chosen name. |
| 7 | Check that the support address works. | Send a message to `support@guildedwow.com` from another account and see it arrive. | Play shows this address publicly; it must not be a personal one. |
| 7b | Confirm the public deletion address. | Nothing to click: read the account-deletion address in `play-listing.md`. If the website's new public deletion page has its own address by then, that one goes into Play and into the app instead. | The address the website worker reports. Today's answer works: `https://guildedwow.com/docs/PRIVACY#choices-access-and-deletion`. |
| 8 | Save or submit each **App content** card after the agent has typed the answers. | Play Console → **Policy → App content**: Privacy policy, App access, Ads, Content ratings, Target audience, News apps, Data safety, Government / Financial / Health, Advertising ID. Read each, then **Save** or **Submit**. | The answers are in `play-data-safety.md`, `play-content-rating.md` and `play-closed-test.md`; French copies beside them. These are legal declarations in his name. |
| 9 | Read the French store text and save the listing. | **Grow users → Store presence → Main store listing** → **Save**; **Store settings** → category **Social**, the support address, `https://guildedwow.com` → **Save**. | Nothing: the agent has pasted the text and uploaded the icon, the feature graphic and the seven screenshots. |
| 10 | Read the Testers Community instructions and give the group address. | Sign in at https://www.testerscommunity.com → dashboard → guide "How Testers Community works". Copy the exact Google Group address and read anything newer than this file. Read their refund policy. | The Testers Community sign-in. Search results show `testers-community@googlegroups.com`; confirm it there before it is typed into Play. |
| 11 | Accept Play App Signing when the first release is created. | **Test and release → Testing → Closed testing → Manage track → Releases → Create new release** → accept **Play App Signing**. The agent then uploads the `.aab` and pastes the release notes. | The `.aab` from step 5 (the agent has it). Countries are set to **all** and the group from step 10 is added under **Google Groups**, not "Email lists". |
| 12 | Send the app to Google. This is the public action. | **Publishing overview → Send changes for review**. | A last look at the listing. Review takes from a few hours to a few days for a first release. |
| 13 | Start the Testers Community order. This spends the Pro credit. | Only when the closed track says the release is **available to testers**: https://www.testerscommunity.com/submit-app → paste the two links the agent copied from the Testers tab (the web opt-in link and the Play link) and the tester note from `play-closed-test.md` → use the Pro credit. | The two links. The tester note (it tells testers to open the sample guild, since they have no Discord guild). |
| 14 | Leave the test alone for 14 days. | Nothing to click. Do not remove the group, pause or delete the track, unpublish the app or change the countries. | The agent checks the same day that the tester count reaches 12 or more, and keeps the feedback. A tester who leaves and comes back starts again at day 1. |
| 15 | Apply for production. | Play Console **Dashboard** → **Apply for production** when it says the requirement is met → read the agent's draft answers (about the test, the app, and what changed) → **Submit**. | Testers Community's report and anything sent to the support address. Review usually takes seven days or less. |
| 16 | Approve the production release. | **Production → Create new release → Add from library** → release notes → countries → **Send for review**. | Nothing new. |

## After the first upload, before app links work

Links such as `https://guildedwow.com/app/raids` open the app only once the website publishes the app's signing
fingerprint. That fingerprint does not exist until step 11.

1. Play Console → **Test and release → Setup → App signing** → copy the **SHA-256 certificate fingerprint** under
   **App signing key certificate** (the one Google holds, not the upload key).
2. Give it to an agent. It goes into the website build variable `MOBILE_ANDROID_SHA256_FINGERPRINTS` in Cloudflare
   (the owner signs in to Cloudflare), then the site and its Worker are redeployed.
3. Check that `https://guildedwow.com/.well-known/assetlinks.json` answers with that fingerprint.

It must be the real fingerprint from Play. A made-up or upload-key value makes Android refuse the links. It is public
information, not a secret. Until this is done a link opens the browser instead of the app, which is harmless and does
not matter for the closed test.

## Later, when wanted

- Automatic JavaScript updates: create an Expo access token (expo.dev → account → **Access tokens**) and add it as the
  GitHub secret `EXPO_TOKEN`. The update workflow stays manual until he also approves running it on every change.
- Push alerts, if the first bundle went out without them: step 3, the server pull request deployed, then a new build
  with the `production` profile.
