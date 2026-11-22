# Phone app finish-line audit (22 November 2026)

Scope: `mobile/` (Expo SDK 58, app 0.5.0, `top.kcaron.guilded`). First pass: audit, proposals, clear bug fixes. Nothing was built, published, submitted or changed in EAS, Play or Firebase. No real member credentials were used; the live checks were read-only public endpoints of `https://guildedwow.com`.

## What was checked

| Check | Result |
| --- | --- |
| `npm ci` in `mobile/` (own node_modules, no junction) | OK |
| `npm run typecheck` | Pass |
| `npx expo install --check` | "Dependencies are up to date" |
| `expo export` android and ios (fresh worktree) | Both pass |
| Mobile unit tests + `tests/worker-routing.test.ts` + `tests/mobile-release.test.ts` (vitest, root) | 184 pass |
| eslint on changed files | Clean |
| Clash stays out of the bundle | Unchanged (`metro.config.js`, guarded by `tests/mobile-release.test.ts`) |
| `expo-doctor` | Not run (not installed offline; run `npx expo-doctor` once with network) |
| Web build walked at 360x640 in French: intro, Stats, News, Me (signed out), sample guild | See bugs below |

Not walked (needs a device or a real account): sign-in round trip, push, notification taps, verified HTTPS links, dark/light switch (the app is dark only: `userInterfaceStyle: dark`), real offline launch, TalkBack/VoiceOver. Code review of these paths found no defect beyond the notes below.

## What works

- Public data: `summary.json`, `boards.json` (EN/FR, seasons), `duels.json`, `raids.json` all answer 200 and render. French labels are complete.
- Loading, empty and error states use `RetryCard`, `EmptyState` and saved snapshots (`useCachedResource`, `cache.ts`); a failed refresh keeps the saved copy with "Last updated".
- Requests are bounded (15 s). A network failure while renewing the credential does not sign the member out (only 401 does).
- Accessibility: every `Pressable`, `Switch` and `TextInput` has a role or label; tabs have `tablist` semantics; 44 dp targets; Android Back handled on every layer.
- Deep links: `guilded://` and `https://guildedwow.com/app/*` parse to a fixed set of destinations only; notification taps use the same safe parser.
- Sample guild works without any call to the bot. The in-app Delete my data exists (Apple and Play both require it).
- Permissions are minimal (`POST_NOTIFICATIONS`; storage, mic and overlay blocked).

## Bugs

| # | Severity | Bug | Repro | Status |
| --- | --- | --- | --- | --- |
| B1 | **High** | The **News tab never loads on the live site.** The website Worker forwards only `/api/*`, `/leaderboards/*` and a few page prefixes; `/news/headlines.json` is not forwarded, so `https://guildedwow.com/news/headlines.json` answers 404 and the tab always shows "Headlines are unavailable". The bot route exists (`src/services/news-feed.ts`). | `curl -i https://guildedwow.com/news/headlines.json` -> 404; open the News tab. | **Fixed in this PR** (`worker/index.mjs`, read-only GET/HEAD, no cookies, query dropped; test added). Needs a **Worker deploy** to take effect. |
| B2 | Medium | **English error text in French mode.** Guild, Me, Map, Album, wishlist and sign-in screens printed raw `ApiError` messages ("Guilded could not be reached. Check the connection and the server address.", "The request timed out", "The server answered 503"). Offline is the common case. | Switch to FR, go offline, open Guild or sign in. | **Fixed** (`src/errors.ts`: offline, 5xx and 429 are translated; a 4xx keeps the server's own explanation, which is English: see P6). |
| B3 | Low | Stats summary card ignored the language: "Season 1", "Levels 45-59" in French although `summary.json?lang=fr` returns "Saison 1", "Niveaux 45-59". Saved copy was not per language. | FR, Stats tab. | **Fixed** (`?lang=` and per-language cache key). |
| B4 | Low | `MyCharacters` and `AlbumScreen` clear the stored session on a 401 but not the in-memory one, so the UI stays "signed in" with a dead credential until the next refresh or app resume. | Revoke the credential, press Make main. | Not fixed (touches sign-in state; small separate change). |
| B5 | Low | The duel empty note still says the ladder "opens on 1 December 2026"; the live ladder has run since 13 November (the note shows only on a 404, so it is rarely seen). | Code reading. | Not fixed (copy owner decision). |
| B6 | Low | Roster card prints "Guild rank: No guild rank recorded yet" (label repeated). | Sample guild, third character. | Not fixed (polish). |
| B7 | Low | Class names ("PALADIN", "WARLOCK"), boss and raid names are English in French mode (the server sends no French). | FR, Stats. | Not fixed (server data). |
| B8 | Low (store) | `app.json` plugin `expo-notifications` has `enableRemoteNotifications: true` but the README says it is off ("no Apple push key needed"). On iOS it adds the push entitlement, so the first iOS build needs an APNs key. README is stale; the setting is right once push ships. | `mobile/README.md` vs `app.json`. | README line not changed here. |
| B9 | Low | Two different names for the same Android channel `raids` ("Raid reminders" in `syncRaidReminders`, "Raid alerts" in `pushToken`), both English only. The first creator wins. | Code reading. | Not fixed. |
| B10 | Info | The intro hero looks tall on the react-native-web preview at 360 px (title below the fold). Native uses `aspectRatio: 2`; not checked on a device. | Web preview only. | Check on a small phone. |

## Store readiness

**Android / Google Play** (from `ROADMAP.md`, `docs/ANDROID_PLAY_LAUNCH.md`, `mobile/store/`):

- Expo project linked (`ddda073f-...`, owner `kevincaron28`), upload key exists, store builds made by EAS (0.3.0 was versionCode 7; EAS raises it, `app.json` still says 3).
- Play: 0.4.1 live on the closed track (Alpha), 0.5.0 in Google review (ROADMAP, 21 November). The 12 testers for 14 days requirement has no recorded start date in the docs: **confirm the tester count and day count in Play Console**.
- Listing kit, Data safety, content rating, FR copies, screenshots and feature graphic exist in `mobile/store/`. Screenshots predate 0.4/0.5 (five-tab shell, Me, News): refresh before production.
- Firebase/FCM: not connected; the closed-test bundle is `production-no-push` (Alerts tab says push is not set up; push rows are disabled switches). Push needs the Firebase project, `GOOGLE_SERVICES_JSON` EAS file variable and FCM V1 credentials. The bot side (`runMobileAlerts`) is live and idle.
- App links: `https://guildedwow.com/.well-known/assetlinks.json` answers 404 "not configured" (expected). Needs the Play App Signing SHA-256 in `MOBILE_ANDROID_SHA256_FINGERPRINTS` and a website deploy.
- The public site still serves the **preview APK 0.2.0** (`releases.json`, `mobile.android`, built 5 November). It is three feature rounds behind and its News tab is dead (B1). Refresh it or replace it with the Play link once production is open. `site/pages/mobile.md` still says "Coming soon on Google Play" (ROADMAP).
- `EXPO_TOKEN` GitHub secret not set, so the OTA workflow stays idle. Note the runtime policy `appVersion`: any JS-only fix (like this PR) reaches the store build only by a new store build or an OTA published to channel `production`.

**iOS: nothing is started.** Nothing in the repo or docs mentions an Apple Developer Program account (USD 99 a year), App Store Connect record, bundle id registration, signing, APNs key, or TestFlight. The config is ready (`bundleIdentifier`, `buildNumber` 3, `ITSAppUsesNonExemptEncryption: false`, `supportsTablet: true`, associated domains), and the ios export builds. Gaps and risks:

- Account and App Store Connect app record; privacy nutrition labels; iPhone 6.9" and iPad screenshots (`supportsTablet: true` means iPad screenshots are required; the app is capped at 480 dp wide, which looks narrow on iPad: either set `supportsTablet: false` or design for it).
- Guideline 4.8: an app whose account login is a third-party service (Discord) must offer an equivalent privacy-preserving login option, or qualify for an exemption. Review risk: prepare the argument (the app is useful signed out and the sign-in is the guild's own companion flow), or plan for a fallback.
- Review needs a demo path: the sample guild already provides one; say so in the review notes.
- Apple association file (`apple-app-site-association`) 404 until `MOBILE_APPLE_TEAM_ID` is set.
- Icons: 1024 icon and splash exist; check the icon has no transparency for iOS.
- Push on iOS needs the APNs key in EAS (B8).

**Privacy text**: `PRIVACY_URL` (`/docs/PRIVACY`) and `/delete-my-data/` both answer 200. The Data safety answers are written (`mobile/store/play-data-safety.md`). Ads are an open owner decision (ROADMAP T11): the app has no ad SDK; adding one changes Data safety, Play "Contains ads" and iOS labels.

## Research: what guild and companion apps offer

- **Blizzard's own WoW Companion**: guild and community chat, a calendar for guild events, news, character inspect, auction house (removed and missed by users). Reviews mostly complain about crashes, login failures and empty character lists, i.e. reliability beats features.
- **Raid and sign-up tools** (Raidify, Guild Nexus, Guild Order, Guildlume): automatic pings before a raid (24 h, 2 h, 1 h), role/spec sign-up and tentative/absent, who can craft what, self-updating rosters, Battle.net sign-in. Raidify's mobile is a web app; Guild Order has a mobile beta.
- Blizzard announced cross-platform Discord/guild chat for patch 12.1, which will reduce the value of any chat feature in our app.

Sources: [WoW Companion on the App Store](https://apps.apple.com/us/app/wow-companion/id1125608061?l=en), [Raidify](https://discordbotlist.com/bots/raidify), [Guild Nexus](https://www.curseforge.com/wow/addons/guild-nexus), [Guildlume](https://discordbotlist.com/bots/guildlume/upvote), [Guild Order](https://guildorder.com/es/ledger/voice-the-discord-bot-and-more).

## Ranked proposals

| Rank | Proposal | Effort | Why |
| --- | --- | --- | --- |
| 1 | Deploy the Worker fix (B1), then ship 0.5.1 with the B2/B3 fixes (store build or OTA on `production` once `EXPO_TOKEN` exists) and refresh the preview APK/site | S (owner deploy + one build) | News is a headline tab that is dead today. |
| 2 | **Raid sign-up from the phone** (accept, tentative, decline) through a new companion-authenticated route, with reminders at 24 h, 2 h and 1 h that respect the sign-up state | M-L (bot route + screen; the bot already holds sign-ups) | The most asked-for guild-app feature; today signing up opens Discord. |
| 3 | **Remote push** turned on (Firebase + FCM + APNs), starting with raid reminders and help calls | M, mostly owner accounts | The Alerts tab already has the switches and the bot has the scheduler. |
| 4 | **iOS release**: Apple account, TestFlight, 4.8 position, iPad decision, screenshots | M, owner account | Half of a guild's phones are iPhones; the work is mostly accounts and review prep. |
| 5 | World PvP and duel profile pages: a public `pvp.json` plus a Stats section; a character page with "my runs, my rank, my badges" | M (server JSON + screens) | Fills the one known data gap in Stats (README says no world PvP JSON). |
| 6 | Server error text localisation (the server's 4xx messages are English; send a `code` or a French message by `lang`) | S-M | Finishes B2. |
| 7 | Guild calendar view (all upcoming events, not only raids), add-to-phone-calendar | S-M | Matches Blizzard's Calendar; cheap with the existing standings feed. |
| 8 | Fix the minor items B4, B5, B6, B9, tablet layout | S | Polish before calling it final. |

## Decisions and accounts needed from the owner

1. **Deploy the website Worker** after this PR merges (B1). Check `curl https://guildedwow.com/news/headlines.json` then answers 200.
2. **Play Console**: tester count and the day count of the closed test; whether 0.5.0 passed review; when to apply for production.
3. **Apple**: open an Apple Developer Program account (USD 99 a year) and decide on iPhone only or iPad as well; accept or change the 4.8 plan.
4. **Firebase / `EXPO_TOKEN`**: create the Firebase project and the GitHub secret if push and automatic OTA are wanted.
5. **Preview APK 0.2.0 on the website**: refresh it, or hide it once the Play link is live.
6. **Ads in the app**: still undecided (ROADMAP T11); affects every store form.
7. Name: the Play name is "Guild Sync Companion" and the icon label is "Guilded"; confirm the App Store name before the record is created.
