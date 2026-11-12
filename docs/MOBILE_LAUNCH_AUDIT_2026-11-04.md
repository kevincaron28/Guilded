# Guilded Android launch audit · November 4, 2026

**Decision: hold the launch build.** The current phone client can show guild data and edit a wishlist. A temporary service failure can erase a valid session or scheduled reminders. The production EAS profile builds an APK, and no signed-device acceptance evidence was established. This report covers Phase 1. Implementation, release builds and publication are separate gates.

## Scope and evidence

Audited the mobile manifest, dependency manifests and lock, EAS profiles, entry point and tab navigation, all five Guild sections, pairing, API parsers, storage, notification planning and scheduling, translations, fixtures, tests and README. Compared the Worker allowlist and forwarding in `worker/index.mjs` with the bot handlers in `src/companion-api.ts`, website navigation in `site/nav.mjs`, web flows in `src/services/`, registered Discord commands in `src/commands/index.ts` and loaded addon modules in `addon/Guilded/Guilded.toc`. The bilingual command and feature index is in `site/pages/reference.md` and its French counterpart. Source baseline is `e97eb980` on `release/mobile-launch`, branched from freshly fetched main.

| Flow | Web | Discord / addon | Android today | Launch gap |
|---|---|---|---|---|
| Public discovery | Edition-specific runs, guild ranks, player and guild directories, recruitment, open raid spots | Discord commands expose runs and recruitment. Addon supplies run evidence | Home shows weekly totals and top runs. Ranks and Profile open the browser | Retry, empty/offline state and edition-aware destinations. Add discoverable guild/recruitment paths |
| Identity and account | Discord login, personal hub, linking, applications, data controls | Character pairing codes and game-side character capture | Short-code browser approval or pairing, native SecureStore, logout. Personal-only approval leads to an explanation and sign-out | Reliable interrupted sign-in, recovery, account controls and guild selection handoff. Define renewal protocol |
| Characters and membership | Character links, player profiles, badges, availability | Character tools, professions, attunements and readiness | Native character, spec, level, guild rank and core role | Reach linking/availability from the relevant screen. Explain missing membership, permissions and data separately |
| Raids and groups | Calendar, availability, guild recruitment, applications and public raid signup links | Discord handles signups, attendance, core management and group coordination. Addon captures activity | Upcoming raids, next roster, EP/GP, core boards. A Discord button appears only for recognized event URLs in notes | Give members a usable signup or explicit next step, including raids without event links. Surface calendar and availability |
| Loot | Account and companion surfaces differ. Companion manage API supports wishlist, prices and core changes | Addon records reserves and loot. Discord has officer workflows and standings | Read-only uploaded reserves, own-character wishlist add/remove with priority, standings | Preserve ownership and upload authority. Fix concurrent wishlist operations and silent list limits |
| Alerts | Account preferences and calendar | Opt-in Discord alerts and scheduled messages | Opt-in local reminders one hour before raids already downloaded | Remote push requires enrollment, token registration/removal, authorized fan-out, change/cancel handling and delivery testing |
| Community and officer tools | Recruitment, player cards, account data, guild/admin surfaces | Participation, achievements, crafting/bank, polls, games, seasons, raids/BGs, tools and exports | Little beyond Guild member screens | Member discovery/account flows first. Advanced officer operations and native community tools can follow |
| Capture and desktop sync | Website distributes companion | Addon records in-game data. Windows companion reads local files and uploads | No game/file integration | Keep these operations on the clients that have the necessary files |

## Defects and unfinished behavior

| Surface | Finding and user impact | Source |
|---|---|---|
| Session validity | A failed Discord membership lookup can become HTTP 401. Any one of three 401s erases the local credential. A temporary outage can force a valid user through pairing again. Other requests finishing after sign-out or a new session can overwrite current state | `src/services/companion-access.ts:24`, `src/companion-api.ts:596–612`, `mobile/src/GuildScreen.tsx:59–115` |
| Storage and logout | Native credentials already use SecureStore. Failed SecureStore delete is swallowed, so a credential can reappear on restart. Logout waits for best-effort server revocation without a client deadline. Browser preview stores the credential in localStorage | `mobile/src/storage.ts:20–67`, `mobile/src/api.ts:388–411,447–452` |
| Login | Browser approval validates origin and path. Pending request lives in component state. Changing tabs unmounts Guild, and a single poll error abandons pairing. Personal-only session has no direct account or choose-guild action | `mobile/App.tsx:38`, `mobile/src/GuildScreen.tsx:124–132,184–211`, `mobile/src/api.ts:413–435` |
| Home and Ranks | Summary fetch trusts JSON. A successful malformed response without a topRuns array can throw during render. LIVE stays on during network failure. No timeout, retry, pull-to-refresh, cached/offline view or explicit empty top-runs message | `mobile/App.tsx:24–49` |
| Profile, navigation and external links | Profile is a browser launcher. Public and raid buttons do not handle a failed URL open. No incoming URL router or Android verified links. Self-hosted Guild sign-in changes its API host while public tabs keep the default host. The shell also defaults public links to the site's default edition | `mobile/App.tsx:6,32–56`, `mobile/src/GuildScreen.tsx:213–244,421–430`, `mobile/app.json` |
| Characters and reserves | Guild fetch has initial loading and per-service errors, but failed refresh discards previous results. No pull-to-refresh, offline snapshot or foreground refresh. Sample Refresh is visibly actionable and does nothing. Only the first 40 reserve items render | `mobile/src/GuildScreen.tsx:59–102,148–161,279–320` |
| Wishlist | A successful mutation followed by a failed refetch can look like a failed save. Remove permits overlapping changes and stale responses. Offline writes and ambiguous outcomes need explicit UI treatment | `mobile/src/GuildScreen.tsx:328–396` |
| Raids | Standings stop at 20 rows and core rows at 12 without navigation. A failed secondary request can hide parts of a board. Screens map rows inside a ScrollView. Scope large-list virtualization to actual long lists. The current mobile UI has no remote image gallery to cache | `mobile/src/GuildScreen.tsx:139–161,400–446` |
| Alerts | A failed standings fetch is treated as an empty schedule and cancels prior reminders. Invalid-session cleanup can leave old reminders on device. Toggle preference is device-wide. Reconciliation cancels everything before scheduling and overlapping runs can race. Permission is requested before creating the Android channel, and a zero-reminder plan can report success before checking permission. Sample/unsupported/error explanations overlap | `mobile/src/GuildScreen.tsx:71–115,450–471`, `mobile/src/notify.ts:12–45`, `mobile/src/storage.ts:10–12` |
| Accessibility and language | Dark styling exists. The shell duplicates palette/layout, uses fixed top/bottom padding, and does not expose tab roles or selection. Many controls lack accessible names/states or permanent field labels. Guild has partial EN/FR, the outer shell is English, and the signed-in guild screen lacks its language selector. No app-level error boundary | `mobile/App.tsx:10–16,35–65`, `mobile/src/GuildScreen.tsx:124–167,250–269,390–394`, `mobile/src/i18n.ts` |
| Native/build configuration | Name and package already exist. No custom app/adaptive icon or splash assets in mobile, runtimeVersion, updates URL, configured EAS project ID, launch update check, channel mapping or app links. Current 0.1.0 / code 1. Preview builds APK, production also builds APK, and a separate store profile builds AAB | `mobile/app.json`, `mobile/eas.json`, `mobile/package.json` |
| Dependency and CI coverage | Expo's compatibility check flagged Expo, expo-notifications, expo-status-bar, React, React DOM and TypeScript. Root CI does not expressly install/typecheck/export mobile. Existing six mobile tests cover pure helpers and API cases, with no rendered screens, storage failures, notification lifecycle or real-device delivery | `mobile/package.json`, `mobile/src/api.test.ts`, `.github/workflows/quality.yml` |

No TODO/FIXME markers surfaced in first-party mobile source. Form placeholder examples and fictional sample guild data are intentional. The always-on LIVE indicator, sample Refresh and generic alert messages are the misleading elements. The production origin is a public default that can be overridden. Discord event URLs and test fixtures are intentional. No embedded production API key was identified in first-party mobile source or app config. Keep signing material and all service credentials out of source and logs.

Restoring a saved session loses the guild display name because storage serializes `guildName` and the grant parser reads `wowGuildName`. Wishlist permits input beyond the backend's 100-character limit and lacks guidance when no characters are editable. Alerts lists reminder candidates even with scheduling disabled or permission denied, and its time-based lists become stale when the screen stays open across the one-hour boundary.

## Verification performed

- Mobile TypeScript passed. Mobile API, companion-access and companion-hub tests passed together, 18 tests across three files including the six mobile tests.
- Android Metro export passed, producing a 1.8 MB Hermes bundle. This exercises packaging JavaScript. APK installation, native startup and notification delivery still need a signed Android build.
- `expo install --check` returned nonzero for the six dependencies above.
- Anonymous HTTPS GETs on the public Guilded host returned 200 JSON with the four expected summary fields. Players, leaderboards and guild rankings redirected to their Forever edition pages, which returned 200. Hub, manage and standings responded 400 without a guild and 403 for an unauthenticated test guild. The mobile README's old missing-hub warning does not establish a current outage. These probes do not establish authenticated success.
- The hosted Android app-link association path returned 404. Source allows the mobile companion routes. HTTPS verification also needs the public signing fingerprints of the intended installed builds and a served association document. Preserve browser handling for Discord OAuth and companion approval.
- The full root suite, root lint, native release manifests, EAS signing/builds and real-device test matrix remain Phase 3/4 work. No device or published build was used as evidence in this audit.

## Checklist proposed for approval

**Must have today**

1. Preserve native secure storage and server-side guild/character authorization. Fix transient vs revoked responses, session and logout races, offline sign-out and polling recovery. Credentials today are long-lived revocable device secrets. For explicit token refresh, implement a backward-compatible, guild-bound renewal/rotation contract, safe on retry, with failure and revocation tests. Existing Windows clients must continue working.
2. Keep the native character, reserve, wishlist, raid and standings flows. Add discoverable edition-aware browsing, linking, account, guild/recruitment, calendar, availability and signup destinations. Use existing authenticated web/Discord flows where those services own the action. Keep browser handoffs explicit. Confirm the correct guild and character before writes.
3. Validate responses and show loading, empty, error, retry, offline and refresh behavior appropriate to each screen. Retain the last good permitted snapshot, scope private state by account and guild, and clear it on sign-out. Resolve wishlist ambiguity, hidden list truncation and reminder reconciliation. Add the crash fallback, shared dark styling, safe areas, global language preference, labels and selection states.
4. Implement opt-in remote raid alerts end to end, with permissions, enrollment, revocation, delivery, tap routing and deduplication against local reminders. Validate no message after opt-out or guild departure. This needs server support and configured push delivery. An Expo client dependency alone cannot deliver it.
5. Configure the existing EAS project, expo-updates, appVersion runtime policy, preview/production channels, release-only check/fetch/reload and offline startup. Configure verified HTTPS routes, branded icons/splash, package-preserving mobile-only version bump, and APK/AAB profiles. Inspect the final merged permissions manifest. Resolve Expo dependency mismatches first.
6. Require root lint/TypeScript/Vitest/addon validation, mobile typecheck/export and targeted regression tests. Build the preview APK in time for Phase 3 device testing. On physical Android cover cold and resumed launch, every tab/section, personal and guild grants, pairing, browser return, sample, EN/FR, wrong guild, empty data, offline/retry, revoked access, wishlist persistence, denied/granted push, canceled/rescheduled raid, notification tap, cold/warm deep links, OTA compatibility and recovery, large lists and TalkBack. Build production AAB after acceptance.
7. Draft listing, screenshots from accepted flows, privacy checklist/Data safety answers based on actual collection and delivery providers, release notes and future channel-specific update commands. Check the existing bilingual notice in `docs/PRIVACY.md` against mobile behavior. Record JS-only versus native rebuild boundaries.

**Nice to have today** — richer native public browsing and filters, improved personal profile presentation, and larger-screen layout polish after device acceptance of the member flows.

**Post-launch** — native officer configuration, price/roster management, advanced raid and battleground history, professions, badges and community/game features. Desktop file sync and game capture continue to use the Windows companion and addon.

## Coordination and commands

All audit agents report to the coordinator in the original chat. After approval, split the app and server contracts into isolated diffs, have one integrator verify them together, show each diff before its commit, and open a PR against main. Any production API, site-association or notification rollout needs a separate release decision. No publication is part of this plan.

```powershell
# From repository root
npm run typecheck --prefix mobile
npx vitest run mobile/src/api.test.ts tests/companion-access.test.ts tests/companion-hub.test.ts
Push-Location mobile
npx expo install --check
npx expo export --platform android --output-dir "$env:TEMP/guilded-mobile-audit-export"
Pop-Location

# Phase 3 integration gates
npx tsc --noEmit -p .
npx eslint .
npx vitest run
node addon/Guilded/validate-addon.mjs

# Phase 3/4, after EAS profile corrections, from mobile
eas build -p android --profile preview
eas build -p android --profile production
```
