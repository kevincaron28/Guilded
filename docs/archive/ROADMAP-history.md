# Guilded roadmap history

## Snapshot of ROADMAP.md before the 8.5 rewrite (6 November 2026)

Everything below this heading until the next snapshot is the roadmap as it stood after 8.4.6. Open items were carried into the new ROADMAP.md; the rest is history.

> Current checkpoint: [October 30 integration record](RELEASE_INTEGRATION_2026-10-30.md). The latest owner direction authorizes all available testing now and supersedes earlier testing waivers. Historical release notes below are not current availability or acceptance claims.



### Planned — WoW-linked Discord item previews (requested 4 November 2026; not tested)

**Goal:** In Québec Gold's Blizzard-native WoW ↔ Discord linked `#chat-guilde`, keep Blizzard's existing chat relay unchanged. When a player links an item in WoW guild chat, Guilded should display a **Discord-only** rich item preview in that same channel. The preview **must not** be sent back into WoW. No new channel unless the owner approves a fallback.

**Next AI/Claude handoff (5 November):** This is a roadmap request, **not** a tested capability or shipped feature. Desktop Commander `DESKTOP-QLI338Q` was offline during the 4 November attempt; no live webhook test was performed. Before implementation, coordinate with active work and inspect current source, Discord event handlers, permissions, deployment and release gates. Do not change the native Blizzard integration.

1. **Feasibility spike, first:** Confirm Guilded can receive `messageCreate` events from this linked channel, including actual `content`, author/webhook/system metadata and item-link representation (respect Discord Message Content intent and API restrictions). Inspect sanitized event payloads; never log tokens, webhook URLs or private chat. Determine whether item ID and random suffix/enchant data survive the relay or only bracketed display text.
2. **Webhook permission test:** On the linked channel, test whether a Discord webhook can be created and post a **test embed**. Check channel permissions and Discord API responses. Bot normal send may be restricted in Blizzard-linked channels; webhook behavior is **unverified here**. Confirm test embed is visible in Discord and does **not** echo into WoW. Use a temporary webhook, avoid exposing its URL, and clean up the test post. If blocked, record error/status and stop; do not bypass platform restrictions.
3. **Data source:** Identify an accurate, legally usable item database for WoW Forever and custom/changed items. Prefer exact item IDs plus suffix/enchant context; do not present guessed stats as authoritative. When only a name is available, use conservative disambiguation or a simple name/link preview; never silently choose a wrong item.
4. **MVP implementation if tests pass:** Opt-in per Discord guild/channel; observe native-relayed item messages, parse multiple item links safely, deduplicate, cache metadata, rate-limit, and send compact webhook embeds with quality color, icon, item name, verified stats and item URL where available. Avoid mentions, ping storms, loops, replies back into WoW, and bot/webhook self-triggering. Store webhook credentials encrypted/secret-managed, never in source or logs; support disable and deletion. Reuse existing bot architecture and respect multi-guild isolation.
5. **Acceptance:** Verify on live Forever client and Discord with (a) normal item, (b) random-suffix item like `[Training Sword of the Owl]`, (c) custom/unknown item, (d) multiple items, (e) duplicate/rapid messages, (f) no item, (g) webhook denied, (h) restart/retry, and (i) **no Discord embed echoed into in-game guild chat**. Add unit/integration tests, documentation, admin setup and a safe rollback. Keep feature off until accepted; no deployment or release claims before proof.

**Owner preference:** Same linked Discord channel, Discord-only embeds; the original in-game and Discord messages stay intact. Prioritize proof of webhook posting and non-echo before any larger build.


### Built, off by default — Crafter offers: sell a craft as well as ask for one (requested 4 November 2026; awaiting real-server acceptance, see [docs/CRAFT_OFFERS.md](../CRAFT_OFFERS.md))

**Goal:** Today the craft board only goes one way: a member asks (`/craft request`) and a guild
crafter picks it up (`/craft list`, `/craft claim`, `/craft who`, `/craft mine`). Add the other
direction so a crafter can **post a message in Discord offering a craft for sale**, and members can
either ask for a craft or buy a listed one from the same place.

- **Offer post:** a crafter posts an offer for something they can make (item or enchant, price or
  "tips welcome", whether the buyer brings materials, availability or notes). Offer items come
  from the crafter's recorded recipes (the same data `/craft who` uses), so a crafter cannot list
  a recipe their character has not been seen with; unverified free-text offers are clearly
  labelled as such.
- **Buy or ask:** members can answer an offer ("I'd like this") or ask for a craft nobody has
  offered, and both land in the existing request flow so claim, status and completion keep
  working. Reuse the craft forum, status tags and pinned directory instead of a new channel.
- **Guardrails:** offers are opt-in per Discord server, rate limited, expire or can be withdrawn,
  never ping `@everyone`/roles, respect multi-guild isolation (a guild's offers stay in that
  guild), and Guilded never handles gold: members trade in game. Edition-aware (Forever uses
  character names without realms; other editions keep their realm rules).
- **Related cleanup:** the profession directory post lists every stored profession row, so a fresh
  start needs the beta rows removed first (`npm run professions:reset`, preview by default).
- **Before building:** inspect `src/commands/craft.ts`, `src/commands/craft-board.ts` and
  `src/services/profession-directory.ts` for current behaviour; `/setup` and `/config` are close to
  Discord's command-size limit, so the new subcommand must go under `/craft`. English and French
  text, tests, documentation and a safe off switch are required. Keep the feature off until accepted
  in a real server.

### October 30 operational follow-up

**8.3.0 is live:** backend, website and the companion are deployed at reviewed
source `2602e67`. GitHub's 23 public downloads are hash-verified. All ten
CurseForge edition files are approved and their anonymous downloads match the
frozen release ZIPs. Microsoft Store Submission 6 is published; verification of
the installed 8.3 package remains pending. Publication is not native/game acceptance.

The previously selected edition calendars are unchanged, including Forever's
November 4 start. The latest readback and provider evidence are tracked in the
[8.3 acceptance record](../V8_3_0_RELEASE_ACCEPTANCE.md).

The [QuébecGold BG hub](https://discord.com/channels/1323321076478119967/1552246570714402827/1565730945766527019)
is posted in the existing scoped channel with French Create, Join, My groups and
Upcoming buttons. These are deployed **8.3 organization controls only**; result
and statistics controls await the next deployment. Permissions were unchanged,
mentions suppressed, and native button-click acceptance is not yet recorded.

### Historical 8.2 publication checkpoint

8.2.0 is deployed and published on GitHub at `eb3cb4a`; all 23 anonymous downloads
and the tag were verified. All ten CurseForge files are published and verified;
Store 8.2 is published, installed and signature/hash verified. Forever's prospective timing snapshot is installed without moving
November 4. The newer [edition calendar authorization](../EDITION_CALENDARS_2026-10-30.md)
starts empty other editions prospectively with official period labels and gives
Era a three-calendar-month cadence. Production activation and readback passed
at 12:14 UTC October 30.
The [battleground module](../BATTLEGROUNDS_NEXT_MODULE.md) is approved as the next
isolated module. It is not part of the published 8.2.0 feature claims.

### Today's integration work — 30 October 2026

Today's authoritative work list and release gates are in the
[October 30 integration checklist](RELEASE_INTEGRATION_2026-10-30.md).
The selected additions are implemented in 8.2.0: signup-based supply planning, approved
missed-raid catch-up, progressive onboarding, personal calendar export, versioned
raid playbooks, officer handover/change review, read-only external evidence links,
member data centre, and explainable bench-rotation suggestions. The checklist
also tracks accessibility/context/recovery checks and the feature-freeze target.
Forever's researched upcoming-season timing snapshot is installed. Historical
season scores remain frozen. Live acceptance and the newer edition-calendar
initialization are tracked separately from the implemented feature inventory.

### Current stage — 6 November 2026

Guilded **8.4.6** is prepared (member ledger sync, the live duel board, the companion account-folder fix, combat-safe windows, the compact Crafted by tooltip and the Forever-only focus, on top of 8.4.5's milestone announcements on by default, new achievements, duels, the guild message assistant and addon fixes, on top of 8.4.4's WoW Forever launch-week release: automatic linking, synced-realm guild key, Forever-first, crafter offers, companion saved-data detection and addon UI fixes, on top of 8.4.3's WoW Forever launch fixes for the companion and 8.4.2's startup-crash fix and Link everything polish on top of 8.4.1's owner console, quick reference, achievement cards and guild rank); published baseline is 8.4.0.

Guilded **8.4 source candidate** is being integrated on
`codex/bg-recorder-history-oct30`. The provisional BG pipeline is implemented in
source: capability-checked Forever postmatch self reports, SavedVariables through
Companion, independent server consent and paired ownership checks, replay/conflict
handling, private result cards/history, withdrawal with a reason, and consented
seasonal player-participation statistics separated by edition, mode and API bracket.
Conflicts include a bounded explanation. A source-level next-capture shared premade
code supplies an optional correlation hint; it does not establish a universal match ID.

These additions are **not part of frozen 8.3 files** and are not yet claimed
deployed or fully accepted. Integrated regression/migration checks, packaging,
publication and live acceptance remain gates. Verified unique-match totals,
verified match win rates and additional accepted capture adapters remain gated
after the live pilot. Current statistics count provisional player reports, not
unique matches or competitive rating. Forever real-client acceptance cannot
precede November 4. Other unverified queue formats remain planning-only.
See the [BG module checkpoint](../BATTLEGROUNDS_NEXT_MODULE.md) and
[integration record](RELEASE_INTEGRATION_2026-10-30.md).

### Historical 8.1 candidate checkpoint

Guilded **8.1.0 Candidate** (protocol 2), prepared for November 4: RCLootCouncil/Gargul history conversion, reviewed in-game confirmation, separate persistent history and undo, raid-signup presentation and public-origin reliability. See [candidate gates](NOV4_RELEASE_CANDIDATE.md). Kevin selected five additional pre-launch features for work on October 30; their implementation and acceptance are tracked below, not claimed complete. Published downloads remain 8.0.2.

### Historical selected pre-launch work — 30 October 2026

These numbers refer to Kevin's seven-item feature discussion, not the older lists
below. Kevin subsequently targeted a product release today, October 30, and asked
for a whole-product gap review before finalizing scope. WoW Forever opens November 4.
The feature branch is held for review/PC-owner coordination, not a release promise.
See [scope, reuse audit and acceptance checklist](PRELAUNCH_COMMUNITY_2026-10-30.md).

3. **Targeted group/vacancy alerts:** extend existing opt-in group alerts with
   role/time filters, expiry, quiet hours and strict notification limits.
4. **Cooperative guild challenges:** reuse canonical dungeon runs and eligible
   participation; do not count observer uploads as separate runs. Recognition
   is cosmetic, with no competitive rating, balance or legacy reward changes.
5. **Optional personal weekly recap:** build on existing report windows and
   member data; private preview first, explicit opt-in and delivery approval later.
6. **Companion sync clarity:** show edition, character, watched folder and distinct
   saved/uploaded/accepted status; preview redacted diagnostics before the existing
   report handoff. Coordinate integration with the active Companion PRs.
7. **Weekly community question/poll:** moderator configuration and preview;
   no automatic activity points or new recurring posts before delivery approval.

Personal dungeon goals (1) and mentoring (2) were **not selected**. All new
recurring delivery stays inactive until audience, channel and cadence are approved.
Preserve stable 8.0.2, rc.1 and Store Submission 5 bytes/manual publication hold.
Release work remains owned by session `01a181ce-30fa-7c60-b973-c385d45d3502`.
The coordinated continuation in draft PR #282 adds stored `/dungeon watch`
preferences/private matches, configured `/dungeon together` goals and saved
`/poll weekly-preview` reviews with Post/Skip/Pause. Automatic alert rollout is
held; weekly questions require an officer click. The local integration owner
`01a18c22-fb70-7ea2-8689-7c2a85655ad7` owns items 5/6, combined checks and release.

Published baseline: 8.0.0: security, reliability, ledger storage compaction, versioned Retail overtime scoring, origin isolation, French indexing, accessibility and Core presentation extraction. See [8.0 readiness](releases/V8_0_LAUNCH_READINESS.md) for publication gates and the owner's testing waiver.

Previous published 7.5.1: loot rules follow the original EPGP/soft-reserve rules, guild directory and player search, and Codex's dungeon evidence work (Season 1 stays on current-v1).
Previous: 7.5.0, combining the release-gap bundle and Claude’s raid/interaction fixes.
The original 8.0 baseline passed combined CI, backups, deployment and publication gates. Its retained downloads and earlier evidence are in [8.0 release evidence](V8_0_RELEASE_EVIDENCE_2026-10-28.md).
Real-client checks remain post-release follow-up; see [the release decision](RELEASE_DECISION_2026-10-25.md).
Current gates and completed operational checks: [launch readiness](LAUNCH_READINESS_2026-10-24.md).
GitHub and CurseForge publish 8.0.2 for all five editions and the bot runs its reviewed source. All ten approved CurseForge files match GitHub. Store Submission 4 publishes 8.0.2.0; its actual installed signature, submitted application bytes and retained encrypted profile/account activation passed. See [current provider evidence](releases/V8_0_2_RELEASE_EVIDENCE_2026-10-28.md). Previously both addon providers published 7.5.0;
see [the publication record](RELEASE_EXECUTION_2026-10-25.md). All six
18-October requests shipped in 7.0.0; 7.1.0 added monthly boards and Raider.IO-style leaderboards,
7.2.0 companion Sign in with Discord and one-click updates, 7.2.1 a steadier bot, 7.3.0 the dungeon
result card, raid vacancies and public player profiles, 7.3.1 level-aware raid readiness and the
companion updater repair.

WoW Forever launches **4 November 2026** at 3 PM Pacific; dungeon Season 1 starts at the same
moment (23:00 UTC, `/guilded-season`). The beta closed on 21 October, so the real-client checks
still owed — G6-G8 (dungeon runs), G10 (French client) and the 6.1.2 parts of G2/G12 — can only
run on live servers; see [the 6.2 game acceptance record](../V6_2_GAME_ACCEPTANCE.md). Forever's
first raids (Barrow Deeps, 10 players; Hyjal Summit, 20) open on 9 December. Launch-week priorities
and the competitive review: [PRE_RELEASE_AUDIT_2026-10-22.md](PRE_RELEASE_AUDIT_2026-10-22.md).

### Built

- WoW addon: raid attendance, EPGP, GP bids, council, soft reserves, priority loot,
  recipes, guild map, readiness, calendar integration where the client supports it,
  dungeon scores, games and backups.
- Discord bot: setup wizard, cores and signups, standings, personal pairing,
  crafting, onboarding, community seasons/activities, participation and PoE2 journals.
- Windows companion (the browser companion was removed in November 2026): personal uploads and standings; file
  watching and optional PoE2 log tracking.
- Phone app in `mobile/` (not a store release): the public boards, and Discord sign-in for characters
  (guild rank and spec), reserves, wishlist, raid standings and on-device reminders. See [mobile/README.md](../../mobile/README.md).

Built does not mean every live workflow has passed. Recorded two-player results
cover map visibility/privacy, recipes, bidding/council/reserves, GP accounting and
sync. Fresh-guild setup, installation/recovery, concurrency, permissions and a
full raid still have outstanding acceptance checks.

### Next

Candidate feature progress while the game is closed: [raid presets, signup layouts,
score cards and quieter companion sync](PRELAUNCH_FEATURES_2026-10-24.md).
Game acceptance starts when access returns. The owner authorized 7.3.2 publication
before those checks; the subsequent feature bundle shipped in 7.4.0 and 7.5.0.

New local review bundle: [roster, crafting, teams, history, groups, main/alt and
limited GRM review, opt-in availability, local activity heatmap and Retail key
sharing](LOCAL_FEATURE_BUNDLE_2026-10-25.md). This bundle is published;
game validation remains pending. Claude's live checks are in the
[post-release review](POST_RELEASE_REVIEW_2026-10-26.md).

1. Make independent guild setup clear and rehearse a clean install. Aim for
   30 minutes with hosting/database/DNS ready; see [QUICK_START.md](../QUICK_START.md).
2. Test a genuinely fresh Discord guild and an ordinary member, and complete
   the Windows clean-install/upgrade/recovery checks.
3. Finish the real-client checklist and real raid, verify final-commit CI,
   then publish/promote matching packages as appropriate to the evidence.

### Website — 16 October 2026

Phase 1 (simpler guilded.kcaron.top and kcaron.top) is live from PR #86.

1. **Phase 2 visuals.** Replace the homepage's companion setup screenshot with
   real in-game screenshots (guild window standings, dungeon finder). The owner
   supplies the screenshots.
2. **A public page per guild.** When a guild sets up the bot, it gets a draft
   page such as `guilded.kcaron.top/g/<guild-name>/`. Officers choose what is
   public (raid times, cores, rosters, EPGP or loot rankings, recruitment) and
   publish it; nothing is public by default. Quebec Gold's page is the first one
   and replaces the hand-copied `/quebec-gold/cores/` snapshot with live data.
   The bot serves these pages through the Worker; the static homepage stays as is.
   - Earlier draft: the ChatGPT conversation "Portfolio Website Expansion"
     (16 October) produced `KCaron-Portfolio-Guild-Pages.zip` and a
     `LOCAL-AGENT-PROMPT.txt`. They were never pushed or downloaded to this PC,
     were built on an older `main`, and include a 14-project portfolio that
     conflicts with the simpler phase 1 design. Reuse ideas from it, not the files.
   - Open questions: page address and slug rules, which data officers may
     publish, French and English versions, search indexing on or off per guild,
     and whether Discord-only guilds (no addon) get a page.

### Requested — 18 October 2026

In suggested order: quick wins first, then things that build on each other.
How each one gets built: [ROADMAP_REQUESTS_PLAN_2026-10-18.md](../ROADMAP_REQUESTS_PLAN_2026-10-18.md).

1. **Done in 6.6.0. Ko-fi support links.** The Ko-fi page ([ko-fi.com/wowguilded](https://ko-fi.com/wowguilded)),
   the website footer and CurseForge's Donate button already exist. Add the link
   to the bot's `/help`, the companion app and the addon's Settings page, in
   English and French. It's a link only: no features behind a payment.
2. **Done in 7.0.0. Spreadsheet export from the addon.** The in-game part shipped in 6.6.0
   (`/guilded sheet`, Copy for Excel); the companion CSV export and `/officer export` shipped in 7.0.0.
   - *In game:* an "Export" button on the standings, roster and loot windows
     opens a copy box with tab-separated text. Ctrl+A, Ctrl+C, then paste
     straight into Excel or Google Sheets; each value lands in its own cell.
     Works with no companion. (WoW addons can't write files themselves.)
   - *Companion:* the companion already reads SavedVariables, so it gets an
     "Export to spreadsheet" button that saves a `.csv` file (opens in Excel)
     with one sheet's worth per table: EP/GP, attendance, loot history,
     dungeon scores. A bot `/export` that sends a CSV of the guild's server-side
     data comes later, for officers only.
3. **Done in 7.0.0 (provisional targets until real timed runs). Next dungeon season covers all levels, not just 60.**
   Rules version 6 has brackets 15-29 / 30-44 / 45-59 / 60 and an over-level penalty; a season
   still needs launch data and real timed runs for each bracket's targets. The November draft
   ([NOVEMBER_DUNGEON_CATALOG.md](../NOVEMBER_DUNGEON_CATALOG.md)) proposes a
   level-60, best-eight competition. Change it to level brackets (for example
   15-29, 30-44, 45-59 and 60) with each bracket's own dungeons, targets and
   leaderboard, so levelling characters compete too. Each bracket still needs
   real timed runs to set its targets before the season starts. Decide: the
   bracket boundaries, whether a character's run counts in the bracket of the
   level they were at the time, and whether to show one combined ranking.
4. **Done in 6.6.0 (idle Lite servers warned, then left). Guilds join on their own, with a lite version until approved.** Any Discord
   server that adds the hosted bot is accepted automatically and can run setup
   in a **lite** mode (setup, help, basic signups and dungeon groups). The owner
   approves a guild with a bot command, which unlocks everything (EPGP, loot,
   companion sync, seasons, guild page). Needs: a stored guild status
   (lite/approved/blocked), a check on each command, an approval queue sent to
   the owner, and per-guild limits to protect hosting costs. This changes the
   "Later" item below about managed multi-guild hosting from "maybe" to planned.
5. **Done in 7.0.0 (`/mod recruit`, guilded.kcaron.top/recruitment/). Online core and guild recruitment on the website.** Builds on the public
   guild pages above. Guilds publish an opt-in recruitment listing (classes and
   roles wanted, raid times, language, faction, server); cores do the same for
   open spots. Players browse and filter on the website and apply; the
   application arrives in the guild's Discord as a message officers can accept
   or decline. Players can also post a "looking for guild" profile. Approved
   guilds only (item 4), with a report button against spam.
6. **Done in 7.0.0 (Guilded Dungeons addon, guilded.kcaron.top/leaderboards/). Standalone dungeon module and a public leaderboard (Raider.IO-style).**
   A separate small addon, "Guilded Dungeons", for players with no guild or a
   guild without Guilded. It shares Guilded's dungeon code and timers so scores
   match exactly, and the two addons don't conflict when both are installed
   (one counts the run, not both). Players upload runs with the companion,
   paired to a personal account instead of a guild. The website gets
   leaderboards by dungeon, level bracket (item 3), class, role and season, and
   a profile page per character, plus a page per guild for Guilded guilds that
   opt in. Needs: a way to sign in without a guild, cheat checks on uploaded
   runs (party members must agree, time limits), and a database change.
   Largest item on this list: do 3 and 4 first.

### Requested candidates — 25 October 2026

Current local implementation: [integrated candidate and remaining scope](LOCAL_FEATURE_COMPLETION_2026-10-25.md).
Claude's `816c7af` fixes are integrated locally. The table below is the historical
candidate capture; its review-only language predates Kevin's implementation
authorization. Current changes remain uncommitted and unpublished for local review.

Kevin requested these Pandy Guild Management-inspired ideas be captured in the
backlog at 13:18 Toronto time (17:18 UTC). This is a documentation handoff only,
not an implementation order, release promise, or permission to copy code or
branding. Priority and acceptance criteria remain to be decided. Existing release
restrictions and pending real-game/two-PC checks remain unchanged; ongoing
Claude Discord acceptance testing takes precedence over new development.

The parent reference-review session `01a17143-42e2-7129-8654-1dffa2316017`
inspected reference images `4304.png` and `4305.png` and supplied the transcription.
The forwarding/materialization session `01a17413-6a26-7000-9ec1-b489c30da01f`
did not inspect pixels because transfers failed. The receiving PC session has
not visually inspected the originals, and local transfer is not confirmed. Library references and the
transfer limitation are retained in the local coordination record
`backups/CODEX_CLAUDE_COORDINATION_2026-10-25.md`. These are candidate ideas, not
verified client API capabilities.

Follow-up code review and proposed acceptance criteria:
[feature candidate review](FEATURE_CANDIDATE_REVIEW_2026-10-25.md).
The owner subsequently authorized starting implementation, kept local for review.
The first addition is the signed-in officer roster dashboard described there;
it and the subsequent feature bundle shipped before 8.0. The documentation-only restriction below describes the
original handoff, not this later local implementation authorization.

| Candidate | Existing Guilded overlap and deferred scope |
| --- | --- |
| Guild dashboard | Cards for total members, active this week, max-level members and vitality; class/race/level/profession breakdowns and activity/inactivity distribution. Filters: Everyone, Max level, Active 30d, Mains only. Define vitality, activity sources, freshness and edition-specific level caps first. Extend existing addon spreadsheet, companion CSV and officer exports; exports are already built ([export plan](../ROADMAP_REQUESTS_PLAN_2026-10-18.md#2-spreadsheet-export--built-game-companion-bot)). |
| Guild group board and native finder integration | One board with role, dungeon, key-level and needs-tank/healer filters, complementing Blizzard Group Finder where supported. Existing Discord group posts/queue live in `src/services/dungeon-group.ts` and `dungeon-group-queue.ts`. Reconcile the previously removed duplicate in-game finder before implementation: restoring it requires an explicit scope decision. Native finder integration feasibility is UNKNOWN. |
| Who's Free, keys and alts | Availability with automatic busy status while in instances; keystone and alt lists. Compare current group queues and character links before designing a new store. Decide opt-in visibility, stale/offline status and how availability is sourced. Instance detection and key APIs across clients are UNKNOWN until researched and tested. |
| Multiple raid teams and attendance | Core/Trial/Bench roles, schedules, missing raid buffs and attendance assigned to the correct team with alt credit to mains. Build on existing bot cores, signups, roster and attendance ([core planning and raid-night tools](releases/V6_5_0_RELEASE_NOTES.md)); verify exact gaps first. Automatic attribution and buff checks need client evidence. Reconcile the [retired addon raid-tool scope](raid-tools/README.md) and separate Pullscript project before expanding addon responsibilities. |
| Online activity heatmap | The local hour-by-weekday view on each player's PC is built (addon Availability page). A guild-wide web heatmap was declined by the owner on 26 October 2026: activity samples stay on each player's PC. |
| Guild crafter lookup | Recipe/item search for guild crafters and possible profession-window integration. Recipes/crafting already exist (`addon/Guilded/Modules/Recipes.lua`, `src/services/recipes.ts`, `src/services/craft.ts`); compare their search and sharing flows before marking gaps. Profession-window integration and edition-specific recipe APIs are UNKNOWN. |
| Searchable roster and history | Extend existing character main-alt links, roster views/exports and history rather than duplicate identities. Review search/filter gaps and history coverage; preserve Forever first/last names and Blizzard realm identity. |
| Reviewed officer bulk actions and GRM imports | Candidate design only. Define preview, permissions, conflict handling, audit and recovery before any implementation. No bulk actions are authorized by this entry. Investigate GRM import format, provenance, consent and compatibility; do not assume a supported import path exists. |
| Shared data and local privacy | Reuse the existing paced guild addon-message transport in `addon/Guilded/Util.lua`. Team edits require officer authorization; private notes/settings remain local. Define field-level privacy, authority/conflict rules, data sources, freshness, retention/deletion and upload/publication boundaries before expanding synchronization. |
| Edition gates and feasibility | The reference omits M+ for Forever. Gate Retail/M+ candidates to supported clients and preserve guild/edition separation throughout the addon, bot and companion, including several editions in one Discord server. API availability, combat restrictions, native finder integration and profession integration remain UNKNOWN until researched and tested in each relevant client. |

These comparisons identify reuse opportunities, not new acceptance evidence.
The original backlog handoff authorized only capture. Kevin subsequently authorized
local implementation; see [the local bundle](LOCAL_FEATURE_BUNDLE_2026-10-25.md)
for completed work and remaining scope. Game actions, commits, publication, push,
merge and deployment remain outside this local review pass.

### Commands — 18 October 2026

1. **Done in 6.7.0.** Members see only their commands; leader and officer tools moved to
   `/lead`, `/officer` and `/organize`, and `/setup` warns when a role can't see them.
2. **Done in 7.3.0 where Discord's limits allow.** `/system` and `/uninstall` are now
   `/setup system` and `/setup uninstall`; `/profile` is `/character profile` (27 to 24 top-level
   commands). Kept on purpose: `/config` (with it, `/setup` would be about 4,150 of Discord's 4,000
   characters; it left `/setup` on 8 October for that reason), `/team` (with `/core` about 4,980),
   and `/tag` (`/tag show` and `list` are for members, and `/mod` is hidden from members).
3. **Then.** Drop slash commands that only repeat a button (for example `/raid signup`,
   `/community lottery join`, `/craft claim`) once each button is confirmed to work in Discord.

### Later

- The raid-leader addon is **Pullscript** (a separate project in the owner's `Wow Addons`
  workspace, CurseForge project 1729283): target icons and world markers, tank marking, boss
  plans shared to the group or posted in chat, pull timer and ready check, and a read-only import
  of Guilded's old `raidPlans`. On 20 October 2026 it gained the last two features of Guilded's
  [raid tools archive](raid-tools/README.md): clearing every group icon and marking a
  target by command (local 0.1.0-beta.14; not yet released, real-client checks pending).
- Additional standalone-first-run improvements described in
  [STANDALONE_ADDON_ROADMAP.md](../STANDALONE_ADDON_ROADMAP.md).
- Managed multi-guild hosting is now planned through item 4 of "Requested"
  (automatic joining with a lite version); self-hosting stays supported.

Historical feature plans are in [the roadmap archive](ROADMAP-history.md)
and version handoffs. Their old version numbers and pending-test statements
must not override the current release testing record.

### Community achievements implementation — 27 October 2026

The requested 100/300/500 badge shelves, silent legacy baseline, reviewed helper/event
achievements and scoped congratulations are implemented in the badge change.
See [implementation and rollout](../COMMUNITY_ACHIEVEMENTS_2026-10-27.md) for privacy,
transaction/delivery guarantees, activation gates and the deferred max-level evidence
requirement. The badge implementation is deployed and retained in 8.0. Per-guild activation and legacy baseline rules still apply; game acceptance is separate. Dungeon integrity and shared transport also shipped before/in 8.0.

### Dungeon integrity draft - 27 October 2026

The first tranche fixes DPS/DAMAGER role parity across both addons, companion and score views; newly frozen official seasons require current evidence while old snapshots and Beta history remain readable. See [implementation, proposed versioned policies and remaining launch checks](../DUNGEON_INTEGRITY_2026-10-27.md). The implemented role/evidence corrections shipped before 8.0 and are retained in its published packages. Season 1 uses current-v1; timer/presence/finality alternatives in the design record remain proposals, not silently enabled policies. Real-game validation is still outstanding; historical scores were not reset.


## Older roadmap (September–October 2026)

# Guilded — Roadmap

Living roadmap for the Guilded Discord bot + WoW addon. Update this file
as work happens so a fresh session (or a future you) can resume from it
alone. Two parts: **Part 1** is the correctness audit that's now done, kept
as a historical record. **Part 2** is the forward-looking feature roadmap
toward a full Guild-OS-style manager with Discord housekeeping built in.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · **P0/P1/P2** =
priority (P0 = do first) · **S/M/L** = rough size

---

## ⏸ Where we are — resume here (updated 2026-09-26, v3 release day)

**Status: v3.0.0 is built and tested (306 tests, addon validator clean).** Version 3.0.0
of the addon and bot, the companion desktop app, CHANGELOG, LICENSE (PolyForm Noncommercial 1.0.0), SECURITY.md
and the CurseForge kit (docs/RELEASE_CURSEFORGE.md) are done. What is left is in
**TODAY_TODO.md** (replaces the old launch checklist): free disk space, restart the bot,
test in game, take screenshots, upload.
Not seen by anyone yet: how the new window, the forum craft board and the companion tray
look on a real screen, and the Windows installer build (`npm run dist`).

**Goal (reached 2026-09-27): v2.0.0 (addon + bot) ready for testing, with everything that
can be built without live data or a decision from the user built.** Items
are grouped below; the progress log at the end of this section is updated
after each commit so a session that hits a limit can resume from it.

**Already shipped (v1.x, in the repo):** EPGP ledger and bidding, raids with
waitlist and buttons, loot history, dungeon challenge, module switches,
`/setup` (7 steps, categories, permissions), character import, raid cores with
signup priority, dungeon groups with temporary voice, readiness board with
consumables, Warcraft Logs import, backups, French. See the sections below for
each item's notes.

### v2.0.0 scope

**Addon (Lua), tested with the new fengari harness (`tests/lua/`)**
- [x] **A1 (X3)** Lua test harness: the real addon files run against a mocked game inside vitest.
- [x] **A2 (X1)** Player identity for Forever (`ns.compat.playerKey/normalizeName`) and `/guilded diag` identity line. *(done; `compat.identity`, `/guilded diag`, realm-tolerant matching in every bot import)*
- [x] **A3 (GO5)** Enchant check: which equipped slots lack an enchant, in the snapshot and on the board. *(done; per-slot enchant ids, MISSING_ENCHANTS finding, reason flags in the peer digest)*
- [x] **A4 (X5)** Login digest: "since your last login" summary, `/guilded digest`. *(done; Modules/Digest.lua)*
- [x] **A5 (X6)** `GuildedAPI` read-only v1. *(done; Modules/API.lua)*
- [x] **A6 (X4)** Versioned addon-message envelope (accepts old, sends new). *(done in a lighter form: protocol rules documented, `/guilded peers`; existing messages were already typed KIND|fields)*
- [x] **A7 (X2)** `QGEXP1:` paste export + `/import code:` for members without the companion. *(done; `/guilded share` + `/character sync`, verified Lua-to-TypeScript)*
- [x] **A8 (ID3)** Attendance snapshot: `/guilded snapshot [label]`. *(done; `/guilded snapshot [label]`, local only)*
- [x] **A9 (VG1, VG2)** Casino ban list and session stats. *(built, then removed with the whole casino under N3)*

**Bot (Discord)**
- [x] **B1 (GO3)** Readiness aggregator: one status per member, sorted most actionable first, enchants and attunement target. *(done; summary line, most actionable first, `/readiness raid attunement:`)*
- [x] **B2 (GK2)** `/inactive`: members inactive for N days (read-only report). *(done; `/inactive`)*
- [x] **B3 (GP4)** `/export`: CSV of roster, attendance or loot for officers. *(done; `/export` roster, attendance, loot, EPGP ledger)*
- [x] **B4 (IR4, GK4)** Composition (class, race, level ranges) in `/stats`. *(done as `/guildhealth`)*
- [x] **B5 (RF4)** Bench credit: a BENCHED attendance status that counts as present for EP and rates. *(done; BENCHED status, attendance EP only, full attendance credit)*
- [x] **B6 (GO2)** Loot council mode: points shown but bidding buttons hidden. *(done; `/config loot-mode`, `/loot award`)*
- [x] **B7 (GO7)** `/poll`: officers create polls, members vote with buttons. *(done; `/poll create|close` with buttons (in-game polls not built))*
- [x] **B8 (GP10)** Retention cohorts (30/60/90 days) in `/stats`. *(done inside `/guildhealth`)*
- [x] **B9 (#46 prep)** One `BRAND` constant for the product name used in embeds, so the public rename is a one-line change. *(done; `src/brand.ts`)*

**Release**
- [x] **R1** Addon 2.0.0 (TOC, zip), README/COMMANDS, launch checklist sections for everything new, roadmap final status. *(done; addon and package 2.0.0, `dist/Guilded-v2.0.0.zip`, docs, checklist sections 12-13)*

### v2.4 request list (2026-09-27 night; built in this order, log below)

| # | Request | Plan |
| --- | --- | --- |
| N1 | In game, the standings line always says "character not linked with Discord" | Find why (the companion wrote Standings.lua while nobody was linked, and only refreshes every 15 min, the game only reads it at login or reload). Say the *actual* reason in the UI: "standings not synced yet" vs "not linked: /character claim"; companion refreshes standings every 2 minutes and right after each upload. |
| N2 | The `/reload` that sends data to the bot is too slow: send more often, more consistently | The game only writes the saved file on reload/logout, so the addon gets a **Sync to Discord** button (a click may reload the UI), a "data waiting" banner on a timer, and an opt-in **auto reload at safe moments** (out of combat, not in an instance, at most every N minutes). The companion uploads within seconds of the file changing. |
| N3 | Remove the casino games and the debt ledger completely; keep only 1v1 or chat games like deathroll, nothing against the guild | Replace the Casino module with a small **Roll games** module: 1v1 deathroll, group deathroll (last one standing), high-roll-off. No gold, no wagers, no ledger, no debts, no trade settlement, no house games. Old casino saved data is ignored. |
| N4 | Discord commands: pick from lists instead of typing | Class / race / profession as dropdowns, spec by class, realm defaults to the guild's, `/loot auction` needs only the item (minimum, increment and time default from the guild's settings), time suggestions on `/raid create`, quick reasons on EPGP awards, attunement suggestions. |
| N5 | A clear way to create a raid core in Discord | `/core setup`: a guided message (name in a form, then pick tanks / healers / DPS from member menus, then rules), plus a pointer in `/setup` and `/help`. |
| N6 | Rework the in-game UI so it is much easier to navigate, using other addons as the example | A **Home** page (what is going on right now, your standing, next raid, sync status), tabs grouped in a left sidebar (Home, Raid, Loot, Guild, Games, Tools), one consistent layout, big primary buttons, plain-language labels. Uses the same ideas as GuildOS (dashboard + feature panels), Guild Paragon (sections) and ElvUI-style sidebars. |
| N7 | Crafting: a craft board where open orders and important info are easy to see and people can interact | A **forum channel** (`craft-board`): every request is a forum post with tags (profession, Open / Claimed / Done) and Claim / Done / Cancel buttons inside the post; the post title and tag follow the state; finished posts close. A pinned guide post explains it. Works with `/craft request` too, and falls back to the old text channel if a forum can't be made. |

**Progress log for this batch (newest first):**

- (see "Progress log" at the top of this file)

### Not in v2 (why)

| Item | Why it waits |
| --- | --- |
| #46 public rebrand and CurseForge (M3) | needs a name and logo from the user, and a hosting decision |
| #18 WCL auto-discovery | needs `/wcl report` proven on real Forever logs first |
| #32 calendar sync | needs the output of `/guilded calendar check` |
| #17 web dashboard, #20 achievements/graphs | held; data model still moving |
| #40 fully automatic character linking, IR3 verification | needs the verification design and live testing of `/guilded character` |
| PM1/PM2/IR1 recipes, cooldowns, bank stock | need in-game API discovery on Forever (trade skill and guild bank windows) |
| RF1-RF3 mass invite, group layout, assignments | protected group APIs; needs in-game testing per call |
| ID1 loot responses, GO1 per-core rules | designs touch bidding/EPGP rules; better after v2 feedback |
| G6 roster panel, G1 tooltips, G7 compression | large UI/library decisions (bundling libs) |
| GO8/G13 SoftRes and TMB import | need sample export files from the user |
| LR1, LR2 roster events/permissions, GK1 auto invite, GP1/GP2 event log and DNI list | need live guild-log behaviour on Forever |

### Progress log (update after every commit)

- 2026-09-26 v3.0.0 release prep: versions bumped (addon 3.0.0, package, API), LICENSE, SECURITY.md (GP14), CHANGELOG.md, docs/RELEASE_CURSEFORGE.md, TODAY_TODO.md replaces LUNCH_TEST_CHECKLIST.md, stale casino text removed from READMEs. #46 partly done: the name, logo and screenshots are the user's.
- 2026-09-26 Companion desktop app: `companion-app/` (Electron: window with Status/Settings/Activity, tray icon with status colours and menu, start with Windows, auto-detect the WoW file, connection test). Shared `companion/engine.mjs`; the command-line watcher now uses it. Screenshots of the window checked; the tray and installer build (`npm run dist`) not verified because the disk was full.
- 2026-09-28 Small items done: weekly raids (`/raid create weekly:true`; ending one creates the next, migration raid_repeat_weekly), module-request rate limit (GP9), slow-handler timings in `/guilded diag` (IR6). 298 tests.
- 2026-09-28 RF1 done: `/guilded invite raid|missing` mass-invites the next raid's Discord signups (bot API -> companion -> Standings.lua -> addon). #40 (automatic character linking) is done in effect: see "Automatic character sync".
- 2026-09-28 N6 done: tools window rebuilt with a grouped sidebar, Home page, page titles and tooltips, Player field only where used, permanent Send to Discord button; the real window code is built and exercised in the Lua tests (tests/lua/window.test.ts), but how it LOOKS has not been seen. Addon 2.4.0.
- 2026-09-28 N7 done: craft board is a forum (post per request, status and profession tags, buttons, "Request a craft" form, DMs, auto-close); old text channel still works.
- 2026-09-28 N5 done: `/core setup` guided wizard (name form, member menus per role, rules buttons, EP form), pointer in `/setup` and `/help`.
- 2026-09-28 N4 done: dropdowns for class and profession, suggestions for spec, race, own characters, attunements, items, tags, raid titles and times, reasons and auction length; `/loot auction` needs only the item; realm optional on `/character add`; tests/commands-shape.test.ts checks every command against Discord's rules.
- 2026-09-28 N3 done: casino, house games and debt ledger removed; Modules/Games.lua (high roll, deathroll, duel, no gold); addon 2.4.0 pending release notes.
- 2026-09-28 N2 done: /guilded sync and auto-save at safe moments (Modules/SyncNow.lua).
- 2026-09-28 N1 done: standings message says the real reason; companion refreshes standings every 2 minutes.
- 2026-09-27 night: the user asked for N1-N7 (table above) and went to sleep; working through them in order N1, N2, N3, N4, N5, N7, N6 (UI last: biggest, least testable).

- 2026-09-26 14:40 A1 done: fengari harness; Consumables.lua and Core.lua (`/guilded character`) verified against the mocked game.
- 2026-09-26 16:10 A2-A9 done (addon side complete, 60 Lua tests through the harness). Next: bot items B1-B9, then release.
- 2026-09-27 21:00 v2.3: character line fixed (QG2, semicolons), realm rename keeps guild data, recurring recruitment post removed, automatic character discovery and auto-link by Discord name, `/character claim|link|unclaimed|autolink`, `/config auto-import`, companion API host setting and failed-login throttle, Oracle deployment kit (`docs/DEPLOY_ORACLE.md`, `deploy/`). Still open: real ownership verification (IR3) instead of trusting the Discord name.
- 2026-09-27 06:00 v2.2: auto-invite by whisper (GK1) and Anniversary interface number (G11), addon 2.2.0.
- 2026-09-27 05:00 v2.1: per-core point rules and pools (GO1), one saved-data set per WoW guild (G10), `/guilded backup` and `/guilded restore` (GO9), addon 2.1.0, 249 tests. Not built as asked: in-game polls (dropped by you).
- 2026-09-27 01:30 B1-B9 and R1 done. **v2.0.0 is complete: addon 2.0.0 zip in `dist/`, 232 tests green, migrations applied to the live database through `20260927010000_polls`.** Next: the user runs checklist sections 0-13, then push and release.

## History — where we were on 2026-09-24 (kept for reference)

- **Blocked-action popup: fixed.** Cause was registering
  `COMBAT_LOG_EVENT_UNFILTERED`, which addons can't do since 12.0.0
  (Midnight), and WoW Forever inherits that. After removing it and setting
  `## Interface: 16001` (from `/dump select(4, GetBuildInfo())`), the user
  reports the login warning is gone. `validate-addon.mjs` fails the build if
  any file registers a combat log event again.
- **Bot confirmed working live** (`/health`, Server Members Intent on,
  companion API running). Phase 8–11 Discord features not yet exercised live.
- **Addon audit #2 done (v1.2.0, 2026-09-24).** Found after the first
  live `/guilded inspect` returned NOT_READY with no explanation:
  - `READY` was unreachable (INFO findings counted as problems) — status now
    follows the bot's rule (ERROR → NOT_READY, WARNING → PARTIAL), and
    inspect names the empty slots and shows item level.
  - **Critical (bot):** every export carries the officer's whole ledger and
    import refs included the import id, so each weekly import would have
    re-added all past EP/GP. Ledger entries now carry a permanent `id`; the
    companion sends a stable ref; `/import-apply` skips refs already imported
    (`tests/addon-import-dedupe.test.ts`). Live DB had 0 addon imports, so
    no cleanup needed.
  - Empty EPGP reasons would have failed the bot's 3-char minimum and
    rejected the whole import — defaulted in addon and companion.
  - Names normalized everywhere ("bob"/"Bob-Realm" → "Bob"): roster,
    ledgers, attendance, addon-message senders. This also fixed casino
    results counting twice via the sender's own message echo.
  - Active raid now survives `/reload`/disconnect; starting a second raid
    while one is open is refused.
  - `/guilded loot` item names with spaces, `/guilded attune Onyxia Key` (was parsed
    as player "Onyxia"), quoted arguments — all fixed.
  - Peer readiness can only be reported by the character itself (no
    spoofing another player's readiness into officer exports).
  - SavedVariables bloat: events capped at 1000, exports are small markers
    (old versions stored a full DB copy per export), peer readiness spam
    kept out of the journal.
  - Casino: `/guilded casino join` never reached the host (group games could
    not actually be joined) — now an OPEN/JOIN/JOINED addon-message
    handshake. Roll parsing uses the client's `RANDOM_ROLL_RESULT`, so
    French clients work. Mirrored ledger updates only accepted from someone
    involved, or an officer. Wagers capped.
  - Hardening: all sends pcall-guarded and truncated to 255 bytes, event
    handlers pcall-guarded, Midnight "secret value" chat text ignored.
  - New `/guilded officer list|add|remove|rank` (GM only for changes) so rank
    layout doesn't require editing SavedVariables.
  - Companion watcher watches the folder, not the file (a file watch can go
    deaf after WoW replaces the file on save) and prints the exact
    `/import-apply` line.
  - Verified with a 28-check simulation of the addon under a Lua
    interpreter with stubbed WoW APIs (not committed; lives in the session
    scratchpad), plus 60 bot tests, `tsc`, `eslint`, validator.
- **Live-confirmed 2026-09-24:** v1.2.0 loads, minimap button shows,
  `/guilded inspect` names empty slots and reports item level.
- **v1.3.0 (2026-09-24, not yet live):** tabbed tools window with a
  target-aware Player box (user found the first panel clunky), attendance
  from raid presence, version check, bot EPGP standings in game. Verified
  with a 29-check UI/sync simulation plus the earlier 28 logic checks,
  63 bot tests, `tsc`, `eslint`, validator.
- **Still unverified in a live client:** the new window, casino,
  readiness → `/readiness me` end to end, standings sync.
- **Command reference:** `COMMANDS.md`.
- **v1.4.0 (2026-09-24, not yet live):** casino reworked per the user:
  officers only; announcements in party/raid chat so pugs without the
  addon can play (type 1 to join, `/roll`, "stand"); gold or silver wagers
  (`10g`, `50s`, `1g50s`); chat pacing (queued lines merged, sends spaced,
  joins silent, deathroll elimination + next roll in one line); pot entries
  owed to the host; trades with the officer settle debts automatically.
  Window hides officer tabs/tools from members instead of greying them;
  `/guilded help` lists only what your rank can use. In-game raid presence now
  imports into Discord raid attendance (see section A). Verified: 28-check
  casino simulation, 34-check window/sync simulation, 18 core checks,
  66 bot tests, `tsc`, `eslint`, validator.
- **Release:** `dist/Guilded-v1.4.0.zip` built; GitHub release and the
  install-page artifact still point at v1.1.0 — refresh both once the live
  test passes.

---

## ▶ Prioritized backlog (added 2026-09-24 from the "complete recommendation list" review)

Gaps between that list and what's already built. Everything else on the
list (EP/GP/PR, history, decay, audit log, attendance %, signups with role
caps, wishlists, professions per character, readiness, recruitment,
applications, gear snapshots) already exists. Work order is easiest-first
within priority. Update the checkbox the moment an item lands.

**P0 — core gaps (bot-side, testable without the game)**

> *(Superseded by "Where we are" at the top.)* **Resume here (2026-09-25, committed):** everything in P0, P1 #13-16,
> #0 test raid, #19 crafting, #21-23, and all quality-of-life items #24-31
> (autocomplete, friendly times, signup buttons, auto-restart, companion
> setup, French, backups, welcome with role buttons) are done. 126 bot
> tests; 66 + 28 + 18 addon simulation checks. Addon v1.6.0 zip built
> locally, not released. Next: user live-tests (LUNCH_TEST_CHECKLIST.md,
> untracked, plus /setup and the welcome preview); then push, GitHub
> release v1.6.0, refresh the install page. Blocked: #12 WCL
> (credentials). Held: #17 dashboard. Open: profession cooldowns.
>
> **#0 — [x] DONE 2026-09-25.** Bot: `/testraid start|finish|cleanup`
> (`src/services/simulation.ts`, `src/commands/testraid.ts`; `isTest` on
> Member/Raid, migration `20260925095244_test_raid_flags`). Verified end to
> end against the live Postgres in a throwaway guild: 7 signed up / 2
> maybe / 1 waitlisted, late + no-show + walk-in, 3/3 kills, 2 loot
> auctions, both attendance paths (direct and via addon import), EP
> approve twice = paid once, report, stats, cleanup left 0 rows. Addon:
> `/guilded sim start|end|bids|clear` (`Modules/Sim.lua`, same fake names).
>
> **#0 — P0 / M — Raid test environment / simulation (requested
> 2026-09-24 for tomorrow).** No raids are released in WoW Forever yet, so
> the whole raid flow can't be tested for real. Build a way to run a fake
> raid end to end:
> - **In game:** an officer-only `/guilded sim` (or "Test raid" button) that
>   runs a raid with made-up raiders and bosses. It would start the raid, fill
>   presence, mark attendance (some late/absent), record boss kills and loot,
>   and end it, all tagged as test data, using a 5-man dungeon group or
>   solo.
> - **Bot:** a `/raid create` test flag (or `/raid simulate`) that creates a
>   raid with fake signups (including Maybe / waitlist) so reminders,
>   signup embeds, `/raid end` EP proposal, raid report, and loot history
>   can be exercised; plus a matching SavedVariables fixture for the
>   companion → `/import-apply` path (attendance import, no-shows,
>   walk-ins).
> - **Safety:** test data must be clearly marked and removable in one
>   command (`/raid simulate cleanup`), and must never touch real EPGP
>   (separate test member records or a `TEST` sourceRef prefix that
>   standings and reports ignore). Remaining P1:
> #12 WCL (blocked on credentials + confirming Forever logs reach WCL),
> #17 web dashboard (held), #18 WCL auto-discovery (after #12). Next
> unblocked work is P2 (#19 crafting requests) or #21 in-game GP bidding. #12 Warcraft Logs is
> blocked on WCL API credentials from the user and on confirming Forever
> logs upload to WCL. The user must restart the bot to register the new
> commands (`/who`, `/raid progress|note|award-ep`, `/epgp reverse`,
> `/profession who|coverage`, `/config notify-channel`).
>
> Progress note (2026-09-24): one additive migration covers items 4-11 —
> `20260925002811_backlog_basegp_notify_reminders_notes_signups_loot_context`
> (GuildSettings `baseGp`/`notifyChannelId`/`raidReminderMinutes`/
> `epCompletionBonus`; RaidSignupStatus `MAYBE`/`WAITLISTED`; Raid
> `reminderSentAt` + `RaidNote` model; Auction/LootAward raid/boss/
> awardedBy/EP-GP-before; Character `race`/`lastSeenAt`). **Already applied
> to the live Neon DB.** `prisma generate` hit EPERM because the bot was
> running (engine DLL locked) but the types regenerated; restart the bot to
> be safe.

1. [x] **S — `/profession who <profession>`**: every linked character with
   that profession and skill, sorted; plus `/profession coverage` (count and
   top skill per profession). Query only. *(Done 2026-09-24:
   `src/services/profession-search.ts`, `tests/profession-search.test.ts`.)*
2. [x] **S — `/epgp reverse <transaction>`**: officer correction command
   (service `reverseTransaction` already exists); `/epgp history` shows
   transaction ids so they can be picked. *(Done 2026-09-24: `/epgp reverse
   entry reason`; refuses double reversal, other guilds' entries, and
   reversing a reversal; `/epgp history player:` lets officers view anyone.
   `tests/epgp-reverse.test.ts`.)*
3. [x] **S — `/raid progress`**: boss progression from recorded kills: each
   boss, first kill date, total kills, last kill. Query only. *(Done
   2026-09-24: `src/services/progress.ts`, `tests/progress.test.ts`.)*
4. [x] **S/M — Minimum (base) GP**: guild setting `baseGp` (default 0);
   PR = EP / (GP + baseGP) everywhere PR is shown or sorted. Standard EPGP;
   stops a new player with 1 GP having a huge PR. *(Done 2026-09-24:
   `priority()` in `src/services/epgp.ts` used by /epgp, /profile, the
   standings API; `/config set baseGp`; companion writes `baseGp` into
   Standings.lua and the addon's STAND sync message carries it, so in-game
   PR matches. Also added `/config set` choices for `raidReminderMinutes`
   and `epCompletionBonus` ahead of items 8 and 10.)*
5. [x] **M — Discord notifications channel**: `/config notify-channel`;
   posts raid started/ended, boss killed, loot awarded (item, winner, GP),
   and EPGP awards (batched per command, not per person). *(Done
   2026-09-24: `src/services/notify.ts`; hooked into /raid start|end|boss,
   /loot close, /epgp award-ep|award-gp|decay|reverse, /import-apply (one
   summary line). Never pings, never throws. `tests/notify.test.ts`.)*
6. [x] **M — Raid notes**: `/raid note <raid> <text> [boss]` officer notes
   (general, per boss, "improve next time"); shown in `/raid status`.
   *(Done 2026-09-24: raid-leader only to add and to see; `RaidNote` model,
   `raidService.addNote`, `tests/raid-notes.test.ts`.)*
7. [x] **M — Signup Maybe + waitlist**: signup status Available/Maybe;
   when a role is full, new signups go to a waitlist and auto-promote when
   a slot frees; embed shows Maybe and Waitlist sections. *(Done
   2026-09-24: `/raid signup availability:Maybe`; full role → WAITLISTED
   instead of an error; cancellations and raised caps (`/raid edit`)
   promote the earliest waitlisted player per role and DM them; embed has
   Maybe and Waitlist fields. Maybe/waitlisted aren't counted as no-shows.
   Tests in `tests/raid.test.ts`.)*
8. [x] **M — Raid reminders**: ping signed-up members N minutes before start
   (guild setting, default 60), once per raid. *(Done 2026-09-24:
   `src/services/reminders.ts`, checked every 5 min from main.ts; posts in
   the raid's signup channel, pings only SIGNED_UP members; marks the raid
   before sending so it can never double-ping; `/config set
   raidReminderMinutes` (0 = off). `tests/reminders.test.ts`.)*
9. [x] **M — Loot history detail**: record raid, boss, awarding officer, and
   EP/GP before/after on each award; show in `/loot history`. *(Done
   2026-09-24: `/loot auction` takes optional `boss`/`raid`; closing
   snapshots the winner's EP/GP before the award and who closed it;
   `/loot history` shows item [boss, raid], winner, GP, GP before → after,
   awarding officer, date.)*
10. [x] **M — EP award proposal with approval**: after a raid ends (or after
    addon attendance import), the bot proposes EP (attendance + per boss
    kill + completion bonus, from settings) with Approve / Cancel buttons;
    approval creates the transactions. Never automatic. *(Done 2026-09-24:
    `/raid end` shows the proposal; `/raid award-ep raid:` re-proposes any
    time (e.g. after `/import-apply` adds attendance). EP = attendance
    (`attendanceDkp`, late `lateAttendanceDkp`) + kills × `bossKillDkp` +
    `epCompletionBonus` on a full clear. Approve (EPGP officers only)
    recomputes and writes EP_AWARD rows with `sourceRef raid-ep:<raid>:<member>`
    so a raid can never be paid twice. `src/services/ep-award.ts`,
    `src/commands/ep-award.ts`, `tests/ep-award.test.ts`.)*
11. [x] **S — Character race + last seen**: store race on `/character add`,
    last seen from addon roster/readiness imports; show in `/profile`.
    *(Done 2026-09-24: `race` option; `lastSeenAt` moves forward only, from
    imported gear checks and from being seen in a raid group that matched a
    Discord raid; shown in `/profile` and `/character list`.)*

23. [x] **M — Guided first-time setup (`/setup`).** *(Done 2026-09-25,
    requested: "a complete idiot can set it up". Private click-through
    wizard: roles (create missing, give yourself Guild Master), channels
    (pick or auto-create announcements / raid signups / private officer
    log), welcome + auto-roles (warns if the bot's role is too low), EPGP
    recommended values + reminders + weekly report toggles, then a
    checklist where every ❌ says how to fix it, plus a "post getting
    started guide" button. Also: `/help` (rank-aware), greeting in the
    system channel when the bot joins a server, and a setup status line
    in the bot console at startup. `src/commands/setup.ts`,
    `src/services/setup-status.ts`, `src/commands/help.ts`; tests check
    every wizard screen against Discord's component limits.)*

**Quality of life — recommended 2026-09-25 (not started, easiest first)**

24. [x] **S — Raid ID autocomplete.** *(Done 2026-09-25: raid, auction, bank, craft, EPGP entry, application, import options; `src/services/autocomplete.ts`.)* Every `raid:` option (and auction /
    bank / craft IDs) suggests upcoming raids by title and date as you
    type, so nobody copies IDs again.
25. [x] **S — Friendly raid times.** *(Done 2026-09-25: `src/services/raid-time.ts`, EN+FR, DST-safe; timezone in /setup and `/config timezone`.)* `/raid create time:` accepts
    "tonight 8pm", "friday 20:00", "2026-10-01 20:00" in the guild's
    timezone (new setting in /setup), instead of strict ISO-8601 — the
    biggest remaining trap for non-technical officers.
26. [x] **M — Signup buttons on the raid post.** *(Done 2026-09-25.)* Tank / Healer / DPS /
    Maybe / Can't come buttons on the live signup embed; no command needed.
27. [x] **S — Bot auto-restart.** *(Done 2026-09-25: start-bot.bat loop.)* The desktop shortcut restarts the bot if
    it crashes, and the console shows a clear "bot stopped, restarting"
    line.
28. [x] **S — One-click companion setup.** *(Done 2026-09-25: `npm run companion:setup`, start-companion.bat.)* A script that finds the WoW
    folder, generates the upload token, and writes both `.env.local` and
    `companion.config.json` (today this is manual and error-prone).
29. [x] **M — French language option.** *(Done 2026-09-25: bot `src/i18n.ts` —
    signup post/buttons/replies, waitlist DM, reminders, announcements,
    raid report, weekly stats, welcome default + role prompt, getting
    started guide, /help follow the guild language from /setup; officer
    admin replies stay English. Addon v1.6.0 `Locale.lua` — player window,
    minimap tooltip, bid popup, and bidding chat lines; auto from the game
    client, `/guilded lang en|fr|auto`; officer tabs and casino chat lines stay
    English for now.)* Bot replies and addon text in
    French for a Quebec guild (`/setup` language choice).
31. [x] **M — Welcome by channel / DM / both, with role buttons.** *(Done
    2026-09-25, requested: "access to either game of the server or both".
    Up to 5 role buttons on the welcome message; clicking toggles the role,
    works from DMs; DM falls back to the channel if closed; only roles still
    configured are honoured. /setup step 3 + `/config welcome send_to
    role_prompt preview`. `tests/welcome.test.ts`.)*
32. [~] **M — In-game guild calendar sync** *(Requested 2026-09-25.)* Only
    if WoW Forever's client has the calendar and lets addons use it.
    Discord stays the one official signup list.
    - [~] **S — `/guilded calendar check`** (addon v1.6.1): reports whether the
      calendar API exists, whether you can create events, and lists guild
      events for the next 14 days. **Waiting on the user to run it in
      game** — the answer decides the next two steps.
    - [ ] **M — In game → Discord:** addon exports guild events and each
      member's response; `/import-apply` creates/updates the matching
      Discord raid and signups (accepted → signed up, tentative → Maybe,
      declined → Can't come) with the normal caps/waitlist rules.
    - [ ] **S/M — Discord → in game:** companion writes upcoming Discord
      raids into the addon folder; officer's Raid tab gets a "Create
      in-game event" button (calendar event creation needs a real click).
30. [x] **S — Nightly database backup** *(Done 2026-09-25: `src/services/backup.ts`, backups/ gitignored.)* (export key tables to a dated file,
    keep the last 14).

**Addon modules and distribution (requested 2026-09-25)**

Decision: **one addon with module switches, not separate CurseForge
addons.** Every module runs on Core (saved data, officer checks, names,
addon messaging, the tools window) and Sync (standings, version check).
Split addons would each need Core as a dependency, several downloads for
members, and version skew between parts that talk to each other
(bidding/casino/dungeon protocols). One install with switches gives guilds
the same choice. Casino, GP bidding and Dungeons are a single project on
CurseForge; a guild that doesn't want the casino turns it off for everyone.

M1. [x] **M — Module switches** *(Done 2026-09-25.)* `/guilded modules`
    (list), `/guilded modules on|off <module>` (just you), officers
    `/guilded modules guild on|off <module>` (everyone, shared through Sync
    as `MODS|updatedAt|by|off-list`, newest officer setting wins,
    non-officer and stale messages ignored, members who log in later ask
    with `MODSREQ`). Switchable: casino, bidding, dungeon, calendar, sim.
    Always on: Core (raids, EPGP, loot, gear check) and Sync. Saved
    settings load only at login, so every module file still loads and
    stays dormant when off: events, tickers, commands, help lines, window
    tabs and widgets check `ns.moduleActive`. Off works at once; turning a
    module back on that was off at login needs `/reload`. Tools tab has a
    row per module with your switch and (officers) the guild switch.
M2. [x] **S — Module integration audit** *(Done 2026-09-25.)* Checked
    every cross-module call (all guarded), event overlap (bidding reads
    whispers, casino reads party/raid chat, only the casino parses rolls,
    the dungeon tracker ignores raids), prefixes (one per module, ≤16
    chars), and load order (UI harness now loads all 11 files in TOC
    order). Fixed: an unguarded standings call in the window, a dead
    `ns.simBidders`, sim sub-commands that needed a switched-off module.
M3. [ ] **M — CurseForge packaging** (when the user wants a public
    listing): CurseForge project + `## X-Curse-Project-ID` in the TOC,
    a `.pkgmeta` (or a packaging step) that ships only
    `addon/Guilded` without `validate-addon.mjs`, a license, the
    description/screenshots page, and a GitHub Action with the BigWigs
    packager on tags. Consider whether the Standings.lua file written by
    the companion should move to SavedVariables-free delivery for guilds
    without the companion (it already falls back to officer sync).

**Dungeon Challenge system (requested 2026-09-25) — build in this order**

Source: a detailed spec the user pasted (ChatGPT). Kept: permanent run
records with unique ids and duplicate protection; explicit run states;
stable ids (instance/encounter ids, never names); one compatibility layer
for every WoW API call; never faking a stat the client can't give;
bot-side configurable points with an audit trail; anti-farming;
seasons, records, achievements, rankings computed from stored runs;
offline-safe local storage until the bot confirms; protocol versions;
/reload safety; logged admin commands. Adapted: reuse the existing
`Core.lua + Modules/` layout and the companion → `/import-apply` sync
instead of a new folder tree or network path; deaths come from each
player's own addon (the combat log is blocked since 12.0), and players
without the addon show "deaths not tracked" instead of a guess;
completion = final boss from the Encounter Journal when the client has it,
otherwise the leader/officer presses Complete. Dropped: `/dungeon start`
and `/dungeon cancel` in Discord (Discord can't control the game; they
are in-game buttons), race tracking, a new folder structure.

Rules that apply to every step: reliability over feature count; one
failing API or event disables only that feature; points are never sent
by the addon, only computed by the bot from rules.

D1. [x] **M — Compatibility layer (addon `Compat.lua`)** *(Done 2026-09-25, v1.7.0.)*: every WoW API
    the dungeon system uses (instance info, group members and roles, GUIDs,
    encounter journal, time, death state) behind `ns.compat`, each checked
    before use, failures logged to `/guilded diag`, `/guilded dungeon check` reports
    which features are available on this client.
D2. [x] **M — Run tracker (addon `Modules/Dungeon.lua`)** *(Done 2026-09-25, v1.7.0; 29-check simulation incl. reload, abandon, peer merge, missing API.)*: state machine
    DETECTED → STARTING → ACTIVE → COMPLETED / ABANDONED / INVALID / ERROR;
    one recorder per group (leader if they have the addon, else first
    addon user by name) so five clients don't make five runs; timer starts
    at the group's first combat after entering (or Start button);
    encounters from ENCOUNTER_END; own deaths from PLAYER_DEAD shared
    after combat; per-player time present; saved every change so /reload,
    disconnect, or a crash resumes the run; runs kept until the bot
    confirms them.
D3. [x] **M — Sync + validation (companion, bot)** *(Done 2026-09-25: per-run zod + server checks, id + near-duplicate dedupe, acceptedRunRefs back to the addon.)*: runs in the export
    with `protocolVersion` / `addonVersion`; bot validates (known shape,
    duration 3 min – 4 h, no future timestamps, 1–5 players, completion
    state), rejects duplicates by run id and by same dungeon + same
    players + start within 2 minutes; stores `DungeonRun` +
    `DungeonRunPlayer`; companion writes accepted run ids back so the addon
    can mark them synced.
D4. [x] **M — Points (bot)** *(Done 2026-09-25: rules in dungeon-rules.ts, weekly repeat share, point transactions with rule source.)*: configurable rules (completion, 0/1/2
    deaths, personal record, guild record, first completion, full guild
    group, under target time) and anti-farming (per player per dungeon per
    week: 1st 100%, 2nd 50%, 3rd+ 0%, configurable); every point is a
    `DungeonPointTransaction` with reason, run, source.
D5. [x] **M — Seasons, records, leaderboards (bot)** *(Done 2026-09-25: /dungeon leaderboard|records|player|history|season; season start/end moves to D7 admin.)*: seasons with
    start/end, archived not deleted; records (fastest, fewest deaths) per
    dungeon, guild and personal; `/dungeon leaderboard [dungeon]
    [weekly|season|all]`, `/dungeon records`, `/dungeon player`,
    `/dungeon history`, `/dungeon season`.
D6. [x] **S — Announcements** *(Done 2026-09-25: one post per import, dungeon channel or notify fallback, /config dungeon-channel + /setup.)*: completed runs, new personal and guild
    records in a dungeon channel (/setup + `/config`).
D7. [x] **M — Admin + audit** *(Done 2026-09-25: /dungeon-admin invalidate|award|audit|config|target|season-start; every change is a new point row + DUNGEON_ADMIN audit + officer log. force-complete stays in game: /guilded dungeon complete.)*: `/dungeon invalidate`, `award`, `remove`,
    `force-complete`, `audit`, `config`, `season start|end`, all logged.
D8. [x] **M — Achievements** *(Done 2026-09-25: permanent, no points; earned at import, revoked with an invalidated run, Season Champion on season-start; Dungeon Master count in /dungeon-admin config. "All dungeons" = N different dungeons, since the client has no reliable list.)*: First Blood, No One Dies, Speed Demon
    (target time), Record Breaker, Dungeon Master (all dungeons), Guild
    Squad, Season Champion — rules in config, permanent.
D9. [x] **S — In-game view** *(Done 2026-09-25: Dungeons tab for everyone: live run, start/complete/abandon/check, recent runs + sync state, season top from Discord via Standings.lua; EN/FR.)*: a Dungeons tab (current run, timer,
    Start / Complete / Abandon buttons, recent runs, your points).
D10. [x] **S — Test path** *(Done 2026-09-25: /testraid dungeon through the real import, /guilded sim dungeon in game; SIM- runs in a made-up "Test Dungeon", removed by /testraid cleanup and /guilded sim clear.)*: `/guilded sim dungeon` and `/testraid`-style bot
    fixtures that play a full run (including reload, duplicate
    submission, disconnect) so this can be tested before release.

**P1 — second wave**

12. [x] **M — Warcraft Logs, manual import first** *(Built 2026-09-26, awaiting
    the live test in checklist section 8. `/wcl report url:<link|code> [raid]
    [post]` (officers) and `/wcl list`; `src/integrations/warcraftlogs.ts`
    (client-credentials token cache, only warcraftlogs.com hosts are ever
    contacted, site taken from the link so classic./www. both work),
    `src/services/wcl.ts`, `src/commands/wcl.ts`, `WarcraftLogsReport` model,
    tests/wcl.test.ts. Summary = zone, duration, per-boss kills/wipes/best
    kill time, player list; posted to the raid logs channel; a linked raid's
    report gets a Warcraft Logs field. Keys `WCL_CLIENT_ID` /
    `WCL_CLIENT_SECRET` (+ optional `WCL_BASE_URL`) live only in `.env.local`.
    Still unconfirmed: that Forever logs upload to WCL and on which site;
    deaths are not pulled yet.)*: `/wcl <report url>`
    pulls the report through WCL API v2 (GraphQL, client-credentials
    auth, keys only in the bot's `.env`, never in the addon), stores a
    compact summary (zone, duration, bosses killed/wipes, deaths, player
    list) linked to the raid, posts a raid report embed, and links to WCL
    for detail. No DPS leaderboard / "raid score" by design.
13. [x] **M — Automated raid report embed** (duration, raiders, bosses,
    EP awarded, loot and GP spent, WCL link) posted when a raid ends.
    *(Done 2026-09-24, minus the WCL link which waits for #12: posted to the
    notify channel when the raid's EP is approved (numbers are final then),
    and `/raid report raid:` posts it on demand. Loot counts only auctions
    started with `raid:`. `src/services/raid-report.ts`,
    `src/commands/raid-report.ts`, `tests/raid-report.test.ts`.)*
14. [x] **S — Player/character search** (`/who <name>`: main, alts, class,
    professions, EPGP, last seen, attendance %). *(Done 2026-09-24:
    exact then partial name match; `src/services/player-search.ts`,
    `src/commands/who.ts`, `tests/player-search.test.ts`.)*
15. [x] **M — Guild statistics / weekly guild report** (attendance trends,
    loot distribution, new members). *(Done 2026-09-24: `/stats [days]`
    (raids, avg raiders, boss kills, EP, loot/GP, new members,
    applications, most raids attended, most loot); `/config weekly-report
    enabled:` posts it to the notify channel every 7 days (hourly check,
    marked before posting). Migration `20260925004829_weekly_guild_report`
    applied to live DB. `src/services/guild-stats.ts`,
    `src/commands/stats.ts`, `tests/guild-stats.test.ts`.)*
16. [x] **M — Guild-bank requests** (request an item, officer
    approves/fulfils, logged). *(Done 2026-09-24: `/bank request|mine|
    cancel` for everyone, `/bank list|handle` for officers; new requests go
    to the log channel; the requester gets a DM on approve/fulfil/deny;
    max 10 open per member; only forward status changes. `BankRequest`
    model, migration `20260925005009_guild_bank_requests` applied to live
    DB. `src/services/bank.ts`, `src/commands/bank.ts`,
    `tests/bank.test.ts`.)*
17. [ ] **L — Web dashboard** (EPGP, loot, raid history) — held until the
    data model settles.
18. [ ] **M — WCL automatic report discovery** (poll guild reports every
    15 min) — after #12 proves which data is actually useful.

**P2 — later / optional**

19. [~] Profession cooldown tracking and crafting requests. *(Crafting
    requests done 2026-09-25: `/craft request|list|mine|claim|done|
    release|cancel`; request shows guild crafters with that profession;
    DMs on claim/done/cancel; claim is race-safe (verified on live DB with
    two simultaneous claims). `CraftRequest` model, migration
    `20260925095707_craft_requests`. Cooldown tracking still open — needs
    addon data.)*
20. [ ] Guild achievements, progression graphs, historical analytics.
21. [x] In-game GP bidding tied to the bot (see section A; L, needs a raid
    to test). *(Done 2026-09-25, addon v1.5.0 `Modules/Bidding.lua` + Loot
    tab: officer opens bidding (one raid-chat line), addon users bid from a
    popup showing their Discord PR, pugs whisper a number; sealed bids;
    highest wins, tie → higher PR → earliest; Award runs `/guilded loot` +
    `/guilded gp` so the GP has a ledger id and imports into Discord. Popups only
    accept an officer's bidding. `/guilded sim bids` for testing. Verified in
    the Lua simulation (20 bidding checks). Not yet seen live.)*
22. [x] **S/M — In-game loot into Discord loot history.** *(Done
    2026-09-25: addon loot rows get a permanent id and the last boss
    killed; the companion exports them; `/import-apply` adds each once to
    `LootAward` (auction now optional, new unique `sourceRef`), linked to
    the Discord raid its in-game raid matched, so `/loot history` and raid
    reports include GP-bidding awards. Migration
    `20260925110000_addon_loot_history` (applied with `migrate deploy`
    because `migrate dev` needs an interactive prompt for the new unique
    column). Verified on live DB via `/testraid finish via_addon`.)*

**P3 — added 2026-09-26**

33. [x] **M — Character import instead of typing** *(Done 2026-09-26, addon
    v1.8.0.)* `/guilded character` in game shows one `QG1|name|realm|CLASS|race|
    level|spec|professions` line (class/race as English tokens, so any client
    language works); `/character import code:` links or refreshes the character
    (professions too; never takes over another member's character). The
    addon export also carries the exporter's own `character` block, which
    `/import-apply` uses to refresh an already-linked character. Why not fully
    automatic: the companion has one guild-wide token and can't tell which
    Discord user a character belongs to. `src/services/character-import.ts`,
    `tests/character-import.test.ts`. See **#40** for the fully automatic
    version.
34. [x] **M — More setup channels, one tidy WoW section** *(Done 2026-09-26.)*
    `/setup` is now 7 steps: channels (announcements, raid signups, **raid
    logs**, officer log), **dungeon channels** (leaderboard, signups, runs),
    **extra channels** (loot and EP log, craft board, recruitment). A
    "Create the whole WoW section" button makes every missing channel under
    one "Guilded" category; feeds only the bot posts in are read-only for
    members. New `/config` commands: `raid-log-channel`, `loot-channel`,
    `craft-channel`, `dungeon-leaderboard-channel`, `dungeon-signup-channel`.
    Raid reports and Warcraft Logs go to raid logs; loot awards and EP/GP
    changes to the loot log; craft requests to the craft board (bank requests
    stay in the officer log). Each falls back to the older channel when unset.
35. [x] **S — Auto-updating dungeon leaderboard** *(Done 2026-09-26.)* One
    message in the leaderboard channel, edited after every dungeon import
    and `/testraid dungeon`; re-posted if someone deletes it.
    `src/services/dungeon-leaderboard.ts`.
36. [x] **S — Commands register in every server** *(Done 2026-09-26.)* They
    were only registered for `DISCORD_GUILD_ID`, so a second server never
    saw `/setup`. Now registered on start for every guild the bot is in, and
    when it joins one.
37. [x] **S — Companion export carries the exporter's character** *(Done
    2026-09-26; part of #33.)*
41. [x] **S — Private raid readiness channel** *(Done 2026-09-26.)* `raid-readiness`
    (Guild Master, Officer, Raid Leader, Loot Leader, Class Leader only; created by
    /setup step 4 or set with `/config readiness-channel`). `/readiness raid`
    posts the guild board there; `/import-apply` refreshes it when gear checks
    arrive. `src/services/readiness-board.ts`. Enchant/flask checks are still
    open (G2, ID2, plus an enchant check in the addon).
42. [x] **M — Consumable scan** *(Built 2026-09-26, addon v1.9.0; Lua only syntax-checked, needs the in-game test in checklist section 9. Flask/elixir/food are matched by buff name (`Flask of`, `Elixir of`, `Well Fed`...); weapon enchants only for yourself; needs `/guilded consumes` from an officer, out of combat and in range. Your own snapshot also records them and adds NO_FLASK / NO_FOOD warnings while you're in a raid group.)*
    Addon: each player's own snapshot records active flask/elixir/food/weapon
    buff; `/guilded consumes` (officer) scans the whole group and prints who is
    missing what; results export to the bot (`ConsumableCheck`) and show as a
    "Consumables" section on the raid readiness board. Enchants are a
    separate later step.
43. [x] **L — Raid cores + roster channel + signup priority** *(Built 2026-09-26; checklist section 10. Priority = a core member takes the most recent non-core signup's slot in a full role; the bumped player is DM'd and goes to the front of the waitlist; waitlist promotion favours core members. Slots are not pre-reserved, by design, so a raid never sits half empty.)* (requested
    2026-09-26). A *raid core* is a named roster (e.g.
    "Tuesday MC core") with roles. **Multiple cores** per guild. A private/
    read-only **roster channel** shows each core's roster as one live message.
    Core members get **priority at signups for that core's raids**: their
    signup takes a slot before non-core players, and a non-core player can't
    bump a core member off the waitlist. `/core create|add|remove|list|post`,
    `/raid create core:<name>`.
44. [x] **M — Dungeon signups with the bot + temporary voice channel** *(Built 2026-09-26; checklist section 11; supersedes #39. The voice channel is private to the group, created at 5 players or on Start now, deleted after 5 empty minutes or on Close. Not yet linked to the run tracker.)*
    (requested 2026-09-26). `/dungeon
    group` posts a signup with Tank/Healer/DPS buttons in the dungeon signups
    channel; when 5 are in (or the leader presses Start) the bot creates a
    **temporary voice channel** for the group, moves nobody by force (it posts
    the link and, if members are already in voice, offers to move them), and
    deletes the channel when it's empty for a few minutes or the group is
    closed. Judged worthwhile: it's cheap, tidy, and dungeon groups are
    short-lived. Needs Manage Channels and (for moving) Move Members.
45. [x] **M — `/setup` organizes the whole server section** *(Built 2026-09-26; checklist section 0.)* (requested
    2026-09-26). Every channel is created in a fitting
    category (e.g. ⚜️ INFO, ⚔️ RAIDING, 🏰 DUNGEONS, 🔒 OFFICERS) with the
    right permissions (members read-only in feeds, officers/raid leaders only
    where private), re-runnable and never touching existing channels. Adds a
    "Organize existing" step that only *moves* channels the bot made.
46. [ ] **L — Public bot identity and CurseForge listing** (requested
    2026-09-26; **last, after the launch test**). Replace the "Guilded"
    name with a neutral product identity so any guild can install it: pick a
    name/logo/tagline (check trademark and that "WoW"/"Warcraft" is used only
    descriptively), rename the addon folder, TOC title, `## SavedVariables`
    (with a migration from `GuildedDB`), slash prefix (`/guilded` stays as an
    alias), bot username and embed branding, docs, install page, GitHub repo
    and release, a per-guild "guild name" setting so the branding is the
    guild's own, CurseForge project page (screenshots, description,
    changelog, license file), Wago listing (M3). Decide multi-guild hosting
    vs self-host first: today the bot is one process per guild owner.
38. [ ] **S — Warcraft Logs in the launch test** — checklist section 8
    (account, client, "do Forever logs reach WCL", `/wcl report`).
39. [x] **M — Real dungeon signups** *(done as #44)*. The signup channel exists but nothing
    posts there yet. A "form a dungeon group" post with Tank/Healer/DPS
    buttons (reuse the raid signup embed) that the run tracker can match to
    a completed run.
40. [x] **M — Fully automatic character import** *(done 2026-09-27 as discovery + auto-link by Discord name + /character claim; real ownership verification is still open, IR3)*. The officer's addon already
    receives every online guildmate's readiness digest over addon messages;
    extend it with class/race/level/spec so one officer export carries the
    whole online guild, and let `/import-apply` create **unlinked** characters
    that a member claims with one click (`/character claim`) or an officer
    assigns. Removes the paste step for everyone who's ever been online with
    the addon.

### GuildOS review (2026-09-26)

Reviewed <https://github.com/danielcosta42/guildos> (MIT; roster/attunement/
loot/recruitment-focused addon for TBC Anniversary and WoW Forever, one build
for both; no Discord, EPGP, bidding, calendar, dungeons or WCL). What it does
better than us, and what we do that it doesn't, drove this list. Pick from it;
none is started.

- **Where we are ahead:** the Discord bot, EPGP with an append-only ledger,
  GP bidding, loot history, raid signups with waitlist, dungeon challenge,
  calendar, module switches, backups, French, a real test path.
- **G1. [ ] S/M — Item tooltips:** show "GP cost / who wishlisted / your PR"
  on item tooltips (GuildOS does wishlist tooltips). Data is already in
  Standings.lua / wishlist; needs a `GameTooltip` post-hook via `Compat.lua`.
- **G2. [ ] M — Consumable check before pulls:** a `/guilded consumes` scan of the
  group for flask/food/elixir/weapon buffs, feeding the readiness report
  (GuildOS scores this into attendance). Our attendance stays Present/Late/
  Absent; consumables would be a readiness signal, not a penalty.
- **G3. [ ] M — Trial member tracker:** trial period, sponsor, auto-expiry
  alert to officers. Fits next to `/application` (Discord) with an in-game
  reminder; a new `Trial` model.
- **G4. [ ] S/M — Officer notes in game,** synced between officers (we have
  `/tag` and member tags on Discord only). Reuse the officer message channel
  the module switches already use.
- **G5. [ ] M — Guild recipe browser:** we track profession *skill*; GuildOS
  keeps every known recipe. Needs a trade-skill window scan (guard
  `C_TradeSkillUI` in `Compat.lua`) and `/craft request` autocomplete from it.
  Ties into #19 cooldown tracking.
- **G6. [~] M/L — Sortable roster panel** in game (level, class, ilvl,
  professions, attunements, attendance, last seen; search; online toggle).
  Our Standings tab shows EPGP only. Highest-visibility feature if the addon
  is ever listed publicly.
- **G7. [ ] L — Sync compression:** GuildOS uses LibSerialize + LibDeflate +
  ChatThrottleLib; our digests must fit 255 bytes. Worth it only if payloads
  outgrow that (would happen with #40 or recipes). Bundling libraries is a
  deliberate packaging change: decide before starting.
- **G8. [ ] S/M — In-game recruitment helpers:** welcome message for new
  guild joiners with the Discord invite link, and a periodic recruitment
  reminder (must be a hardware-click post; addons can't auto-send to channels).
  We already have the Discord-side recurring post.
- **G9. [ ] M — Account-wide alt linking for attunements:** officers link alts
  so one completion counts for all. We link characters to a Discord member,
  so this is mostly reading that link into the addon via Standings.lua.
- **G10. [x] S — Per-guild SavedVariables isolation** (guild name + realm)
  so one WoW install with alts in two guilds can't mix ledgers. Low risk,
  do it before a public release.
- **G11. [x] S — TBC Anniversary support:** GuildOS ships one build for
  Interface 20506 and 16001. Add `20506` to our TOC `## Interface:` and run
  the Compat checks; only worth it if guildmates play Anniversary.
- **G12. [ ] S — Public presence:** CurseForge and Wago listings (M3), a
  screenshot set, a Discord support link, MIT-style license file, changelog.
- **G13. [ ] M — That's My BiS (TMB) CSV import** into `/wishlist`, plus the
  received-loot column into loot history. Guilds that already use TMB won't
  retype wishlists.
- **Deliberately skipping:** hooking the J key to replace Blizzard's guild
  frame (fragile across clients), and rank-checkbox officer config (we use
  Discord roles, which is already how the bot decides).

### Eight more addons reviewed (2026-09-26)

Reviewed from their CurseForge pages, plus GitHub where a repo exists.
Repos found: Profession Master <https://github.com/Kurki/ProfessionMaster>,
Guild Paragon <https://github.com/Earthenmist/Guild-Paragon>, iRC: Guild Connect
<https://github.com/Crasling/iRCGuildConnect>, LibGuildRoster (its CurseForge
page names `Pimptasty/GuildRoster`, but that URL 404s, so it may be private or
renamed). **No public repo found:** vGambler, iddqd, GuildKit. Raidify's addon
has none, but its desktop companion is open source (MIT). Only the feature
lists were read for the ones without source; nothing was copied. Licenses vary
(several are All Rights Reserved), so these are ideas to build ourselves, never
code to lift.

**Profession Master** (guild crafters, cooldowns, leveling planner; Classic
through Forever). Overlaps our `/craft` and `/profession`.
- **PM1. [ ] M — Full recipe database per guild member** (what each person can
  craft, not just skill level), synced with a compressed relay so it doesn't
  spam raids. Feeds `/craft request` autocomplete and "who can make X". Same
  work as G5; do them together.
- **PM2. [ ] M — Profession cooldown tracking** (transmute, cloth, salt, etc.):
  addon reads cooldowns, exports them, and the bot pings the owner when ready
  and lists guild cooldowns. Finishes roadmap #19.
- **PM3. [ ] S — `!who <item>` style lookup in guild chat:** a member types
  it, the addon of any crafter replies (or the bot answers in Discord with
  `/craft who`). Small, very visible.
- **PM4. [ ] S/M — Missing recipes and shopping list:** "recipes you could still
  learn and where", plus a materials list for a crafting request. Optional;
  needs a static recipe source we'd have to maintain, so low priority.
- **Skip:** leveling planner, profit checker and auction scanning. They need
  live auction data and price sources we don't have and don't need.

**LibGuildRoster** (a library other addons use for reliable roster data).
- **LR1. [ ] M — Event-driven roster instead of polling:** build the roster at
  login, then keep it current from system chat messages (joined, left,
  promoted, kicked), so we don't call `GuildRoster()` on a timer. Our
  Compat layer already guards roster APIs; this reduces load and gives us a
  join/leave/promotion event stream for free.
- **LR2. [ ] S — Real officer permissions:** read what the guild master actually
  granted (`C_GuildInfo` / `GuildControlGetRankFlags`) instead of guessing
  officers from rank position. Fixes wrong officer detection for
  `/guilded modules guild` and officer-only commands.
- **LR3. [ ] M — Alt groups from the game itself:** treat characters on the same
  account as one player. Ties into #40 and G9; helps auto-linking characters.
- **LR4. [ ] S — Connected-realm name handling** (`Name-Realm` normalisation),
  needed if Forever ever merges realms. We already normalise names in
  `Core.lua`; add tests for the connected-realm forms.
- **Skip:** sister-guild rosters and mailbox autocomplete. Only useful to
  multi-guild communities.

**vGambler** (roll-off gold gambling: lowest roller pays the highest). Same
idea as our Casino module, which is a superset (pot, blackjack, ledger).
- **VG1. [x] S — Player ban list in the Casino module** (`/guilded casino ban|unban|
  bans`): host can exclude people; persists in the SavedVariables. vGambler has
  it, we don't.
- **VG2. [x] S — Session statistics** (`/guilded casino stats`): games, biggest win,
  net per player for the session. We keep a ledger already; this is a view.
- **VG3. [ ] S — Default stake and a "1 to join" prompt line** matching
  vGambler's flow so players who know it feel at home. Only if guildmates ask.
- **Watch:** gambling on real gold can violate a realm's terms in some
  regions. Keep the "guild fun only" wording in the Casino README.

**Raidify** (raid roster from a web app, mass invite, group layout, assignments,
attendance, bench credit).
- **RF1. [x] M — Mass invite from the signup list:** `/guilded invite raid <id>`
  (officer) invites everyone signed up for a Discord raid, fuzzy-matching names,
  with a "whisper `inv` to be invited" option for late arrivals. Our signup
  data is already in Standings.lua-style exports; needs the raid roster sent
  to the addon (bot to addon, so via the companion's Standings file).
- **RF2. [ ] M/L — Group layout:** the bot lets the raid leader arrange groups
  (tanks/healers/DPS per group) in Discord or the in-game panel; the addon
  applies them with `SetRaidSubgroup`/`SwapRaidSubgroup` (guard the API; it can
  be protected during combat).
- **RF3. [ ] M — Assignments** (interrupts, soulstones, tranq rotations, CC) as
  a note synced between officers and answerable by whisper (`!assign`).
  Overlaps `/raid note`; start by syncing that note in game.
- **RF4. [x] S — Bench credit:** benched players keep full attendance. A
  "BENCHED" attendance status that counts as present for `/epgp leaderboard`
  and EP proposals. Small change in `raid-import` and the attendance rates.
- **RF5. [ ] S — Attendance without a button:** we already sample presence;
  make sure it starts on group invite/raid start automatically (verify in the
  checklist, section 2).
- **Skip for now:** combat-log interrupt/soulstone tracking (the combat log is
  blocked for addons since 12.0.0), and a separate web app.

**iddqd** (loot voting, ready check with consumables, attendance snapshots,
auto-marking, profession sync, gambling, plus a Discord bot and web dashboard).
The closest thing to us; it's a competitor to watch, not to copy.
- **ID1. [ ] M — Loot response voting** (BiS / Upgrade / Minor / Off-spec / PvP /
  Pass) in our bidding popup, so raiders declare need before bidding, and the
  officer sees responses next to PR. Fits `Bidding.lua` and loot history.
- **ID2. [ ] M — Ready check with consumables** (same as G2): flask/food/buffs
  shown on the ready-check reply, exported to `/readiness raid`.
- **ID3. [x] S — Attendance snapshots:** an officer button/`/guilded snapshot` that
  records who's in the raid *now* with a label ("pre-pull", "after Ragnaros").
  Complements our automatic presence sampling; useful for disputes.
- **ID4. [ ] S/M — Auto-marking profiles** (`/guilded mark <profile>`): set raid
  target icons on named mobs. Marking in combat is limited; low priority.
- **ID5. [ ] M — Permission model in the addon:** raid-leader-controlled access
  with assists, guild ranks, or both. We use officer detection; add "assistants
  can start/end raids" as a setting (ties to LR2).

**Guild Paragon** (roster, alt/main tagging, event log, recruitment queue, ban
list, backups, TSV export; Retail and Forever).
- **GP1. [ ] M — Guild event log** (joins, leaves, rank changes, level-ups, alt
  assignments, note changes), exported and shown in Discord as `/guildlog` and
  in the officer-log channel. Builds on LR1's event stream and
  `postToLogChannel`.
- **GP2. [ ] S — "Do Not Invite" / ban list shared by officers** with rejoin
  warnings (when a listed person joins the Discord or the guild, the officer
  log says so). We have `/mod` for Discord; this is the WoW side.
- **GP3. [ ] S — Alt/main tagging with nicknames and aliases,** shown in chat
  hints and `/who`. Our Discord link already gives main/alts; add an in-game
  read of it (same source as G9).
- **GP4. [x] S — TSV/CSV export** of roster, attendance and loot (`/export`),
  for officers who live in spreadsheets. We have backups; this is readable.
- **GP5. [ ] S — Backup and restore in the addon** (before risky operations
  like a season reset), with confirmation for destructive actions.
- **GP6. [ ] M — Recruitment queue:** track prospects the officers whisper,
  follow-up reminders, and stats. Our `/application` covers Discord
  applicants; this covers in-game prospects. Keep it manual (the addon
  can't auto-whisper).
- **GP7. [ ] S — "Officer-only sections hidden from members":** apply to our
  tools panel tabs so members never see officer-only buttons (they're refused
  already; hiding is polish).

**iRC: Guild Connect** (guild home page, member verification, guild bank
overview, shared professions, guild map, challenge-guild rules). It does not
bridge to IRC or Discord despite the name.
- **IR1. [ ] M — Guild bank overview:** the addon snapshots the guild bank
  character's inventory (guild bank tab data when open, or a designated bank
  alt's bags) and the bot lists what's in stock, so `/bank request` can say
  "in stock: 12". Needs the API guarded (`Compat.lua`).
- **IR2. [ ] S — Onboarding for new guild members in game:** a welcome whisper
  with the Discord invite and `/character import` instructions (same as G8).
- **IR3. [ ] M — Member verification:** prove a Discord member owns a WoW
  character with a one-time code typed in a guild note or `/guilded verify <code>`
  (bot-issued). This is the safe way to do #40's auto-linking and stops people
  claiming someone else's character.
- **IR4. [x] S — Guild statistics view** (class/race distribution, level
  ranges, activity) in the weekly report. We have `/stats`; add the
  distribution numbers once the roster is exported.
- **Skip:** guild map, server-wide guild directory/leaderboard, racial chat
  styles, challenge-guild enforcement (race-locked, self-found rules).

**GuildKit** (guild-window toolkit: roster search, analytics, activity feed,
auto-invite phrase, ban list, purge tools; Retail/Classic/Forever).
- **GK1. [x] S — Auto-invite phrase** (`ginv`-style whisper triggers a guild
  invite) with optional level/class/race gates and an officer on/off switch.
  Pairs with the recruitment work in G8/GP6. Guild invites are protected in
  combat only; fine out of combat.
- **GK2. [x] M — Inactivity report and purge helper:** list members inactive for
  N days (from last-seen data we already export) with rank and note filters.
  **Read-only in Discord/addon output**; kicking stays a human action.
- **GK3. [ ] S — Activity feed with notification filters** (level-ups, joins,
  rank changes) as an in-game panel; same event stream as GP1.
- **GK4. [x] S — Composition charts** (class/level/rank/race/zone) in the addon
  and in `/stats`; same data as IR4.

**Common themes to prioritise**
1. **Roster events and real officer permissions (LR1, LR2)** unlock GP1, GK3,
   G8 and GP2. Best foundation to build first.
2. **Recipes, cooldowns and bank stock (PM1, PM2, IR1, G5)** all need addon
   data the companion doesn't carry yet; one shared "extra export" design.
3. **Verification (IR3)** is what makes fully automatic character linking (#40)
   safe.
4. **Loot responses and consumables (ID1, ID2, G2)** improve raid night the
   most and reuse the bidding module.
5. Anything using the combat log (interrupt tracking, soulstones) is blocked
   by the platform since 12.0.0; don't plan around it.

### Code-level review of the addons that have source (2026-09-26)

Read the actual code of GuildOS (`danielcosta42/guildos`, about 60 Lua modules),
Guild Paragon (`Earthenmist/Guild-Paragon`) and iRC: Guild Connect
(`Crasling/iRCGuildConnect`). **Not reachable:** the GitHub URLs for Profession
Master (`Kurki/ProfessionMaster`) and LibGuildRoster (`Pimptasty/GuildRoster`)
return 404 (private, renamed or removed), and vGambler, iddqd, GuildKit and
Raidify's addon publish no source; those were judged from their pages only
(see the earlier review). Licences are "none stated" or all rights reserved, so
everything below is an idea to build ourselves, never code to copy.

**Facts that matter for us right now**
- **Forever's names have no realm and carry a hyphen.** Both GuildOS and Guild
  Paragon special-case it (`IsForeverClient` returns the peer name as is; GuildOS
  builds Forever keys itself and tags exports `game = FOREVER`). Our addon takes
  the realm from `GetRealmName()` (new `/guilded character`, consumable scan) and from
  the companion config. **Verify in game tonight** (checklist section 3) and
  centralise it (item X1).
- **GuildOS's consumable checker only exists on TBC Anniversary** because it
  matches buff *spell IDs* (a TBC list) and is switched off elsewhere. Ours
  matches buff *names*, so it should work on Forever, but it can't tell battle
  from guardian elixirs or see oils on other players. Keep names, add optional
  ID tables later.
- **Their sync is a versioned, compressed, idempotent protocol** (envelope with
  version, message id, entity revision, source; LibSerialize + LibDeflate +
  ChatThrottleLib; every point award has an `opId` applied once). Ours is
  plain pipe strings under 255 bytes with no version field.
- **Two of them test Lua outside the game** (iRC: standalone scripts with a mocked
  WoW API; GuildOS: an in-client `/gos selftest`). Our Lua checks lived in a
  scratch folder and were never committed.

**Recommended next (best value for effort)**
1. **X1: one place for player identity on Forever** (below) and a `/guilded diag`
   line showing what `GetRealmName`/`UnitName` return. Prevents silent
   character-matching failures.
2. **X2: copy-paste export (`QGEXP1:` string)** so a member without the
   companion can send data: in-game box, then `/import code:`. GuildOS ships
   exactly this (`GOSCOMP1:` = compressed, print-safe, pasted into its site).
3. **X3: commit Lua tests** (mocked WoW API, run in CI with a Lua interpreter
   such as `fengari` from npm) plus an in-game `/guilded selftest`.
4. **X4: versioned addon-message envelope** with a protocol number, so old and
   new addons can coexist after an update.
5. **X5: login digest** ("since your last login: new members, loot, raids").
6. **X6: read-only public API** (`GuildedAPI`, versioned) so WeakAuras or
   other addons can read standings and readiness without touching saved data.

**From GuildOS** (`GO`)
- **GO1. [x] M: per-core rules** *(built 2026-09-27: `/core rules` with guild defaults for every core, per-core overrides for EP values, base GP, decay and loot mode, optional separate point pool with `core:` on `/epgp`; tests/core-rules.test.ts. Standings.lua shows the guild pool only.)*. Its Core Manager gives each raid core its own
  loot rules, attendance penalty weights and point pool. Our cores (#43) only
  give signup priority. Add per-core EPGP pool/decay, attendance rules and
  class-default roles (tank/healer/melee/ranged).
- **GO2. [x] M: points modes:** DKP, EPGP or **loot council** (points shown but
  not enforced). We are EPGP-only; council mode is a setting plus hiding the
  bid buttons.
- **GO3. [x] M: readiness aggregator:** one status per member (ready / warn /
  not ready / no data) from attunement + enchants + item level + consumables,
  sorted most-actionable first, optionally against a *target raid* ("not attuned
  for BWL"). We have gear + consumables; add attunements and sorting to
  `/readiness raid` and the readiness board.
- **GO4. [ ] S: attendance penalty for missing consumables** (100% base, minus
  a configurable step per issue), as an opt-in rule tied to GO1.
- **GO5. [x] M: enchant summary** (which equipped slots lack an enchant) in the
  snapshot and board; "four slots unenchanted" is more useful than an item level.
- **GO6. [ ] S: pug inspector:** on joining a group, classify members against
  our own data (Discord ban list from `/mod`, guild roster, alt links, notes).
  Read-only, no new sync.
- **GO7. [x] S: polls:** officers create a poll, members vote (in game and in
  Discord), one result. Simple and popular.
- **GO8. [ ] M: SoftRes import (softres.it / Gargul export)** into the wishlist and
  bidding popup. Guilds using soft reserves won't retype them (see also G13 TMB).
- **GO9. [x] S: backup/restore string** for the addon's SavedVariables ("copy
  this before a risky change"), complementing the bot's nightly database backup.
- **GO10. [ ] S: open crafting-query protocol** (a published addon prefix any
  addon may answer for "who can craft item X?"). Only worth it if other addons
  adopt it; low priority next to PM1.

**From Guild Paragon** (`GP`, adds to GP1 to GP7)
- **GP8. [x] S: public read-only API with a version number** and an explicit
  "no write methods" rule, because writes would bypass permission, sync and
  logging paths (= X6). Their `API.md` is a good template.
- **GP9. [x] S: rate-limit full-state requests between peers** (they cap sessions
  with a request limit, back-off and lease). Matters once #40 sends more data.
- **GP10. [x] M: guild health dashboard for officers:** retention cohorts at 30, 60
  and 90 days, attention signals with severity (critical/warning/info), new-member
  watch. Fits the bot's `/stats` and weekly report better than the addon.
- **GP11. [ ] S: attribute guild events using the native guild log** (who invited or
  kicked whom) so the event log (GP1) names the actor.
- **GP12. [ ] M: import from Guild Roster Manager (GRM)** as a migration path for
  guilds switching to us (they import GRM data). Discord side: `/import` of a
  roster CSV/JSON into characters, alts and notes.
- **GP13. [ ] S: opt-in local performance recorder** (per-operation timings, bounded
  history, no gameplay payloads) so "the addon is slow" reports have numbers.
- **GP14. [x] S: security policy file** (`SECURITY.md`) and contributor notes before
  a public release (= G12/#46).

**From iRC: Guild Connect** (`IR`, adds to IR1 to IR4)
- **IR5. [ ] M: chunked transfer with checksum and "newer wins" tie-break** for
  bigger data (guild bank snapshot, recipe lists): 170-byte chunks, a chunk cap,
  a digest to detect a stale copy, tie-break on save time then owner name.
  Required groundwork for IR1, PM1 and #40.
- **IR6. [x] S (timings only: `/guilded diag` now lists handlers slower than 50 ms as SLOW): diagnostics ring buffer** (500 entries, slow-operation threshold in
  ms, opt-in event tracing). Our `/guilded diag` keeps errors only; add timings.
- **IR7. [ ] M: identity store per guild:** characters, former members and
  "missing counts" (how many rosters a name has been absent from) to tell a
  departure from a temporary absence. Feeds GP1 and GK2.
- **IR8. [x] S: standalone Lua tests** (= X3): their tests load the addon file with
  a mocked `GetBuildInfo`, `UnitName`, `GetRealmName`, frames and `LibStub`, and
  `assert` the behaviour. The same technique works for Consumables.lua and Core.lua.

**From the ones without source** (recap, ranked)
- Profession Master: recipe database with a compressed relay (PM1), cooldowns
  (PM2), `!who` lookup (PM3).
- LibGuildRoster: roster from chat events plus real officer permissions (LR1, LR2).
- Raidify: mass invite and bench credit (RF1, RF4). Its desktop companion is
  open source (MIT); worth reading before we touch our own companion again.
- iddqd: loot response voting and attendance snapshots (ID1, ID3); it also has a
  Discord bot and dashboard, so it's the one to compare against feature by feature.
- GuildKit: auto-invite phrase (GK1), inactivity report (GK2).
- vGambler: ban list and session stats for the casino (VG1, VG2).

**Cross-cutting items (new)**
- **X1. [x] S: player identity on Forever:** a single `ns.compat.playerKey()` /
  `ns.compat.normalizeName()` that knows Forever (no realm, hyphenated names) and
  is used by the consumable scan, `/guilded character`, roster, the companion and the
  bot's character matching. `/guilded diag` prints the raw values.
- **X2. [x] M: `QGEXP1:` paste export + `/import code:`** (compressed, print-safe;
  needs either bundled LibDeflate or a small pure-Lua compressor, decision
  needed). Uses the existing import path, so no new trust model.
- **X3. [x] M: Lua test suite in the repo + CI.**
- **X4. [x] M: versioned message envelope** (`v`, `id`, addon version, payload
  version) with accept-old/send-new during transition.
- **X5. [x] S: login digest.**
- **X6. [x] S: `GuildedAPI` read-only v1.**

---

## Status snapshot (2026-09-24, historical — see "Where we are" at the top)

- Part 1 (correctness audit): **all 12 items fixed and verified.** `tsc`
  clean, 22/22 tests passing, `eslint` clean. Only the manual end-to-end
  Discord+WoW-client test pass (see bottom of Part 1) is still outstanding.
- Part 2 (feature roadmap): research done. **Phases 8, 9, and 10 (full
  scope, including automatic guild-wide addon sync) implemented and
  verified** — `tsc` clean, 35/35 tests passing, `eslint` clean, all four
  migrations applied to the live Neon database. Also fixed a critical
  pre-existing bug in the Lua→JSON converter that would have broken the
  entire addon-import pipeline against real SavedVariables data — see
  Section A's decision-log entry. Phase 11 and the backlog are still just
  planned, not started.

---

## Part 1 — Correctness audit (completed 2026-09-24)

Full original writeup is in git history if the detail below isn't enough;
this is the condensed version now that everything's fixed.

### Critical fixes
- [x] **Readiness pipeline wired up.** `addon-import.ts apply()` now creates
  `InspectedCharacterSnapshot` rows for addon-exported readiness data
  (best-effort — an unmatched character is skipped, doesn't abort the whole
  import). Previously `/readiness` could never show anything but UNKNOWN.
- [x] **Addon EPGP now reaches the bot's EPGP ledger.** Added
  `addonEpgpTransactionSchema` + `epgpTransactions[]` to the addon contract
  (`src/integrations/addon.ts`); `companion/lua-export.mjs` detects
  `db.epgp` vs. legacy `db.dkp` and emits the right shape; `apply()` writes
  real `EpgpTransaction` rows. Previously everything landed in the legacy
  DKP table no matter what.
- [x] **Loot auction bid deadlock fixed.** `placeBid`/`closeAuction` in
  `src/services/loot.ts` no longer require a bidder to already hold GP —
  GP is a lifetime cost tracker (only grows when you win), not spendable
  currency. The old check meant nobody could ever place a first bid.
- [x] **Permission model now matches the docs.** `src/permissions.ts`:
  Officer inherits Guild Master; Raid Leader/DKP Officer/Loot
  Leader/Class Leader all inherit Officer + Guild Master. A Guild Master no
  longer needs to also hold every specific Discord role.
- [x] **Companion API fails closed.** `src/companion-api.ts`'s `authorized()`
  now denies all requests when no token is configured, instead of silently
  allowing everything outside production. A real 64-char token is set in
  `.env.local`.
- [x] **Prisma CLI can find `DATABASE_URL`.** Added `scripts/with-env.mjs`
  (loads `.env.local` then `.env` the same way the app does) and routed
  `prisma:generate`/`prisma:migrate` through it. Confirmed live against the
  Neon database.

### Secondary fixes
- [x] **EPGP decay wired up manually.** `/epgp decay` (officer-gated) applies
  the configured `epgpDecayPercent`. Went with manual trigger over a cron
  scheduler since the bot isn't guaranteed to run 24/7 — a silent scheduler
  miss during downtime would be worse than a manual command. Percent is now
  settable/viewable via `/config`. `epgpDecayIntervalHours` stays unused;
  revisit if the bot ever runs as an always-on service.
- [x] **`/raid boss` command added**, resolving a boss by name within a raid
  and calling the previously-unwired `raidService.setBossStatus()`.
- [x] **`companion/companion.config.json` gitignored** before it can ever
  leak a live upload token.

### Minor / addon fixes
- [x] **Two addon bugs found while wiring readiness** (only mattered once
  the pipeline was actually live): empty gear slots produced an
  empty-string `itemName` that failed the bot's validation and would have
  rejected the *entire* export; item name/id were raw WoW item-link markup
  instead of a parsed name/id. Both fixed in
  `addon/Guilded/Guilded.lua`.
- [x] **False NOT_READY for two-handed weapon users** — missing OffHand is
  now a WARNING, not an ERROR (can't reliably tell "2H equipped" from
  "forgot offhand" from the addon API alone).
- [x] **Slash-command internal name typo** fixed (`QUEBECCOLD` →
  `GUILDED`, cosmetic only).
- [x] **`/profile` shows EP/GP/PR as primary**, DKP explicitly labeled
  legacy; `/dkp`'s description now says it's superseded by `/epgp`.

### Verification
- [x] `npx tsc --noEmit` clean · `npx vitest run` 22/22 passing (added
  regression tests for the loot-bid deadlock and the new EPGP/readiness
  schemas) · `npx eslint .` clean. (2026-09-24)
- [~] **Live end-to-end test — in progress 2026-09-24 (first real run).**
  Findings so far, in case a session gets interrupted mid-test:
  - **Bot login required Server Members Intent to be manually enabled** in
    the Discord Developer Portal (Bot tab → Privileged Gateway Intents) —
    expected per the Phase 8 writeup, confirmed as a real hard blocker: the
    bot could not log in at all without it (`Error: Used disallowed
    intents`). Fixed by enabling it; bot now logs in successfully.
  - **Discord "Application Name" vs. bot "Username" are two independent
    fields.** Renaming the application in Developer Portal → General
    Information does not rename the bot's actual Discord username — that's
    a separate field on the Bot tab. Caused confusion when the bot logged
    in showing its old name after the app was renamed to "Thrall."
  - **Found a real WoW addon bug on first live run:** "Guilded has been
    blocked from an action only available to the Blizzard UI" popup on
    login. Leading suspect was the `OnUpdate`-based auto-sync ticker added
    in Phase 10 (per-frame polling is a common WoW "taint" source) — removed
    it entirely and moved the same debounced sync logic directly into real
    event handlers (`PLAYER_ENTERING_WORLD`, `UNIT_INVENTORY_CHANGED`,
    `GROUP_ROSTER_UPDATE`) instead. **Still occurred after that fix**,
    meaning the `OnUpdate` ticker either wasn't the (sole) cause or there's
    a second issue — not yet confirmed which, since the popup itself never
    names the actual blocked function.
  - **Built a diagnostics tool specifically to stop guessing at this
    class of bug** (`Core.lua`): hooks `ADDON_ACTION_BLOCKED`/
    `ADDON_ACTION_FORBIDDEN` (the events WoW fires with the *exact* addon
    and function name it refused to call — normally invisible unless
    something listens for them) and the global Lua error handler (filtered
    to errors mentioning this addon), logs both into
    `GuildedDB.diagnostics` and prints immediately to chat, and exposes
    `/guilded diag` to review the last 25 entries. **Next step once retested:**
    reproduce the popup with this build installed, read what `/guilded diag` (or
    the immediate chat line) actually names as the blocked function, and
    fix that specifically instead of guessing again.
  - Not yet reached: the rest of the test script below (raid/EPGP/loot/
    companion-import flow) — blocked on getting the addon fully stable
    first.

Original suggested script, still the plan once the addon issue above is
resolved:
  - Two test Discord accounts, one with only "Officer", one with only
    "Raid Leader" — confirm the new permission inheritance behaves as
    intended in real Discord, not just in unit tests.
  - `/raid create` → `/raid signup` → `/raid start` → `/raid attendance` →
    `/raid boss` → `/raid end`.
  - `/epgp award-ep`, `/epgp award-gp`, `/epgp balance`, `/epgp decay`.
  - In-game: `/guilded start`, `/guilded attendance`, `/guilded boss`, `/guilded award`,
    `/guilded gp`, `/guilded inspect`, `/guilded export`. Confirm exported item names are
    clean (not raw links) and a fully-geared 2H character shows
    PARTIAL/READY, not NOT_READY.
  - Point the companion watcher at a live SavedVariables file with a token
    matching `.env.local`, confirm upload, then `/import-apply` and check
    EPGP balances and `/readiness` both update.
  - `/loot auction` → zero-GP test account `/loot bid` → `/loot close` →
    confirm the award posts and GP increases.

---

## Part 2 — Feature roadmap: toward a complete Guild OS + Discord housekeeping bot

### Research (2026-09-24)

Goal was to benchmark Guilded against the popular WoW guild-management
addons and against Carl-bot's Discord housekeeping feature set, to find
concrete gaps worth closing.

**"ForeverLootManager"** (the placeholder addon-source name used in this
repo's own tests) does not appear to be a real, publicly documented addon —
no listing on CurseForge/WowAce/WowInterface/Wago. The closest real match on
the *same server* is a guild-management addon built specifically for WoW
Forever, discussed on Barrens Chat, currently in beta and looking for guilds
to test it: automatic roster sync (gear/specs/professions/attunements, no
manual entry), attendance recorded from actual in-game presence rather than
signups (flags people who signed up but didn't show), loot history + loot
master with loot-council and wishlist support, enchant audit and buff/
cooldown coverage for officers, and an optional website + Discord bot so
signups/attendance show in both places. ([Barrens Chat thread](https://barrens.chat/viewtopic.php?t=13392&p=43128))
This is functionally the same product category as **Guild OS**, which has a
public TBC Anniversary build:

- **Guild OS** — replaces the default guild frame with a roster hub (Name,
  Level, Class, Race, iLvl, Professions, Attunements, Attendance%), synced
  guild-wide via a chunked addon-comms protocol (~5 min interval + manual
  sync). Officer toolkit: enchant audits, raid tools, attendance scoring,
  Gargul-style MS/OS loot master with wishlist awareness and
  attendance-weighted tiebreakers, loot history, trial tracking (configurable
  period, sponsor, status, eval notes), auto-recruit popup on an interval,
  alt linking, rank config. Has an actual `/guildos recruit ... discord ...
  welcome ...` command surface bridging in-game recruitment to Discord.
  ([CurseForge](https://www.curseforge.com/wow/addons/guild-os))
- **RCLootCouncil** (+ the **Merit** module) — the standard loot-council
  addon; Merit adds a transparent, math-based priority score (Audit +
  Attendance + iLvl Boost + Loot Penalties) specifically to kill "loot
  council fatigue" and perceived bias. Directly relevant to how this
  project's EPGP PR score could evolve.
  ([CurseForge](https://www.curseforge.com/wow/addons/rclootcouncil-merit))
- **Gargul** — GDKP/SoftRes/TMB (thatsmybis.com) integration, wishlist
  import with tooltip + roll integration, auto-loot routing (greens to DE,
  epics to ML), auto-invite/sort from a raid signup. No native Discord
  integration — addon-side only. ([CurseForge](https://www.curseforge.com/wow/addons/gargul))
- **Guilds of WoW** (addon + Discord bot combo) — the clearest addon+Discord
  precedent: Discord-side events with role caps (tank/healer/melee/ranged),
  auto-locking signups, attendance synced periodically between Discord and
  the addon, Warcraft-Logs auto-posted to event channels, Google Sheets
  export. ([guildsofwow.com](https://guildsofwow.com/))
- **Carl-bot** (Discord housekeeping benchmark, 349M+ members served) —
  welcome/farewell messages with variables, reaction roles (normal/unique/
  binding/reversed), automod, moderation (warn/mute/ban) with logging of
  message edits/deletes and member join/leave, custom commands/tags,
  starboard, leveling. ([docs.carl.gg](http://docs.carl.gg/), [feature overview](https://bforbloggers.com/carl-bot-features-commands/))

**Takeaway:** Guilded's EPGP/raid/loot core is already ahead of a plain
spreadsheet (which is what several other Forever guilds are still using —
see the CODEX and Mk. Ultra spreadsheet threads on Barrens Chat) but is
behind Guild OS specifically on *automatic* data collection (roster/gear/
attunement sync without manual commands), attunement tracking, and a
loot-council alternative to pure GP-bidding. It has **zero** Carl-bot-style
general Discord housekeeping today — that's a fully new surface, not a gap
in the existing one.

### A. WoW addon upgrades

- [x] **P0 / M — Attunement tracking.** *(Phase 10, done 2026-09-24)*
  `/guilded attune <key>` (self) and `/guilded attune <player> <key>` (officer, append
  `clear`/`false`/`no` to unmark) in the addon, stored in `db.attunements`
  and included in exports. Bot side: new `CharacterAttunement` model
  (migration `20260924124828_phase_10_attunements`), `src/services/
  attunement.ts`, and `/attunement set`/`/attunement list` Discord commands
  (self-service, mirroring `/profession`'s existing pattern). Addon-imported
  attunements flow into the same table via `addon-import.ts apply()`
  (best-effort matching, same as readiness — an unlinked character doesn't
  block the rest of the import).
- [x] **P0 / M — Automatic roster/gear sync between guild members.** *(Phase
  10, done 2026-09-24 — completed in two passes, see decision log for why.)*
  Professions self-report automatically via `/guilded inspect`
  (`GetProfessions`/`GetProfessionInfo`) into the existing `ProfessionSkill`
  table — no new command needed, `/profession list` and `/profile` already
  show addon-synced data. On top of that, per "as much sync as possible":
  `inspectReadiness()` now also broadcasts a compact digest (status,
  missing-gear count, lowest durability, professions) to the `GUILD` channel
  automatically on `PLAYER_ENTERING_WORLD`, on `UNIT_INVENTORY_CHANGED`
  (debounced 5s), and on `GROUP_ROSTER_UPDATE` while in a raid (throttled to
  once per 10 min) — see `maybeAutoSync()` in `Core.lua`. **Revised
  2026-09-24 during live testing:** this originally used a per-frame
  `OnUpdate` accumulator instead of these events directly; removed it after
  hitting a real "blocked from an action only available to the Blizzard UI"
  popup on first live run, since `OnUpdate` polling is a common source of
  WoW's taint bugs. Moved the exact same debounce logic into the real event
  handlers instead — see the live-test findings in Part 1's Verification
  section for the ongoing diagnosis (the popup recurred even after this
  fix, so it isn't confirmed as the sole cause yet). Every other online
  client's addon receives these and stores them in `db.peerRoster`, keyed by
  character; `/guilded export` now includes `peerRoster`, and
  `companion/lua-export.mjs` folds it into synthesized readiness entries
  (real gear list from `/guilded inspect` still only exists for the inspecting
  player — peer digests carry status/professions only, not item names).
  Spec auto-detection and item-level capture stay scoped out — the client
  genuinely lacks both APIs on this interface version.
  **Critical bug found and fixed while building this:** `evaluate()` in
  `companion/lua-export.mjs` treated every WoW-style bracketed-key array
  (`{ [1] = a, [2] = b }` — how the real SavedVariables writer always
  serializes array-like tables, never the compact `{ a, b }` form) as a
  numeric-keyed **object**, not an array, and treated every empty table as
  `{}` rather than `[]`. Since every array field in the addon's export
  (`items`, `findings`, `professions`, `consumables`, ledger entries) is
  exactly this shape, **the entire addon-import pipeline would have
  silently rejected or malformed every real SavedVariables export** —
  something no test in this repo had ever caught, because every prior test
  constructed JSON payloads directly in JS rather than round-tripping
  through the real Lua parser. Confirmed by hand: wrote a realistic fixture
  using the actual WoW bracketed-key syntax, ran it through
  `readAddonExport` before and after the fix, and validated the output
  against the bot's real zod schema end to end (`tests/lua-export.test.ts`
  now covers this permanently — array detection, peer-roster folding, and
  full schema validation, all against realistic Lua syntax rather than
  hand-built JS objects).
- [x] **P1 / M — Attendance from actual raid presence, not just manual
  marking.** *(Done 2026-09-24. Addon v1.3.0: `db.presence` records
  everyone seen in the group while a raid is active; `/guilded attendance seen`
  marks them PRESENT without overwriting manual marks. Bot: the companion
  exports finished raids (marks + presence); `/import-apply` matches each to
  the Discord raid scheduled closest to its start (within 4h), records
  attendance without overwriting Discord-recorded rows, marks signed-up
  members never seen as ABSENT (only when presence was recorded), and
  reports no-shows and walk-ins. `src/services/raid-import.ts`,
  `tests/raid-import.test.ts`.)*
  Hook `GROUP_ROSTER_UPDATE` while a raid is active in the addon
  to auto-record who was actually in the raid group over time, and flag
  "signed up but didn't show" vs. "showed but didn't sign up" — the officer
  `/guilded attendance` command stays as a manual override on top, not a
  replacement.
- [x] **P0 / S — Built-in diagnostics for the addon itself.** *(Added
  2026-09-24, unplanned — came out of live-testing the addon for the first
  time and hitting an unexplained blocked-action popup with no way to see
  which function caused it.)* `Core.lua` now hooks
  `ADDON_ACTION_BLOCKED`/`ADDON_ACTION_FORBIDDEN` (fire with the exact addon
  and function name WoW refused to call — otherwise invisible unless
  something listens for them) and the global Lua error handler (filtered to
  errors mentioning this addon), logs both to `GuildedDB.diagnostics`
  (last 25, also included in `/guilded export`), and prints immediately to chat.
  New `/guilded diag` command reviews recent entries. This is a permanent
  addition, not a one-off debugging hack — it's the addon's only way to
  surface this class of bug without installing a separate error-display
  addon like BugSack.
- [x] **P2 / M — Minimap button with a quick-access menu.** *(Button
  confirmed live 2026-09-24. The first panel was a template text box and the
  user found it clunky, so v1.3.0 replaced it with a tabbed window (Raid,
  EPGP, Me, Casino, Tools) and a shared Player box that fills from your
  target, Me, or a clickable group list; presets for amounts/wagers/
  attunements; one-click casino (the addon rolls for you); two-click confirm
  on whole-group actions; officer buttons greyed out for other ranks. Still
  avoids dropdown menus, unit right-click menu hooks, and StaticPopups
  (common taint sources).)* Original notes: A draggable coin button on the
  minimap opens a plain tools panel: one-click actions plus a text box that
  pre-fills templates for commands needing arguments (refuses to run while
  `<placeholders>` remain). `/guilded menu` and `/guilded minimap show|hide|reset` as
  fallbacks if the button is lost. Built in a way meant to survive Mainline
  API churn: no dropdown-menu APIs, `BackdropTemplate` only when it exists,
  everything created inside `pcall` so a UI failure can never break the core
  addon. Original request text follows. Requested
  2026-09-24 ("we need an addon button in wow to quickly access the
  interface and use all the tools"). A small draggable minimap icon with a
  right-click dropdown covering the main `/guilded` actions (inspect, attune,
  casino games, raid status, diag) so members don't need to remember slash
  command syntax. No external library needed (a hand-rolled draggable
  button is straightforward); deliberately not built yet — held off adding
  more addon UI/frame code while a live frame-related bug was still being
  chased in the same session. Pick this up once the addon is confirmed
  stable in real play.
- [~] **P2 / S — Wishlist / soft-reserve.** *(Bot side done 2026-09-24;
  in-game addon side not built.)* `/wishlist add|remove|list|item` on the
  bot (new `WishlistEntry` table, case/space-insensitive item matching,
  priority 1-3), and `/loot auction` now notes how many raiders wishlisted
  the item. Purely informational — doesn't change how loot is awarded.
  Remaining: an in-game `/guilded wishlist` command and syncing addon wishlists
  through the import pipeline — addon work, untestable while the servers
  are down and the addon has an open bug.
- [ ] **P2 / M — Buff/cooldown coverage check.** Extend `/guilded inspect`-style
  reporting to a raid-wide view: which raid buffs/consumable categories are
  covered vs. missing across the current roster. Officer-only, informational.
- [x] **P1 / S — Addon version check.** *(Done 2026-09-24, v1.3.0,
  `Modules/Sync.lua`; older clients are also whispered directly.)* Broadcast
  the addon version on login; clients print "a newer Guilded is out"
  when a guildmate runs a higher version. Cheap, and it removes the most
  common support problem (members on stale builds).
- [x] **P1 / M — EPGP standings in game.** *(Done 2026-09-24, v1.3.0: bot
  `GET /api/v1/standings`, `companion/standings.mjs` writes `Standings.lua`
  every 15 min, `Modules/Sync.lua` shares it guild-wide in chunks, accepted
  only from officers; `/guilded standings`, EPGP tab shows Discord numbers.)* Data
  only flows addon → bot today. The companion could write a generated
  `Standings.lua` into the addon folder (loaded on `/reload`) so
  `/guilded standings` and the loot flow show the bot's real EP/GP/PR.
- [ ] **P1 / L — In-game GP bidding tied to the bot.** *(Suggested
  2026-09-24.)* Officer shift-clicks an item to open bidding, raiders bid
  from a popup, the winner's GP is recorded with a ledger id (so it imports
  cleanly). Replaces typing `/guilded gp` by hand mid-raid.
- [~] **P2 / M — Casino debt settlement by trade.** *(Built 2026-09-24,
  v1.4.0, not yet seen live: trade money is read on accept and applied
  when the game reports "Trade complete", in both directions. Unverified
  whether Forever restricts any trade events; everything is pcall-guarded.)*
  Offer to clear a debt when a trade with that player completes with gold
  in it.

### B. Discord bot — EPGP / guild-manager upgrades

- [x] **P0 / S — Raid signup role caps + auto-lock.** *(Phase 9, done
  2026-09-24)* `/raid create`/`/raid edit` take optional `tanks`/`healers`/
  `dps` caps (stored on `Raid`); `/raid signup` now requires a `role` and
  `raidService.signup()` rejects once that role's cap is hit (excluding the
  requester's own existing slot, so re-signing up or switching role never
  falsely self-blocks). Auto-lock on `/raid start` turned out to already
  exist — `signup()` already rejected once `raid.status !== "PLANNED"` — so
  no new work was needed there, just test coverage confirming it.
  **New, beyond the original scope:** since the guild has a dedicated raid
  signup Discord channel, added `/config raid-channel` + a live-updating
  signup embed (`syncSignupEmbed` in `src/commands/raid.ts`) that posts once
  on `/raid create` and refreshes in place on every subsequent
  signup/cancel-signup/edit/start/end/cancel, showing status, start time,
  and per-role fill counts. Migration:
  `20260924121417_phase_9_raid_role_caps_and_signup_channel` (adds
  `tankLimit`/`healerLimit`/`dpsLimit`/`signupChannelId`/`signupMessageId`
  to `Raid`, `role` to `RaidSignup` defaulting to `DPS` for existing rows,
  `raidSignupChannelId` to `GuildSettings` — all additive, applied live).
- [x] **P1 / M — Merit-style transparent priority score.** *(Done
  2026-09-24.)* `/epgp leaderboard` now shows 30-day attendance (Present =
  1, Late = 0.5, from `/raid attendance` records on COMPLETED raids), and
  `/config merit enabled:true` orders it by PR x attendance instead of raw
  PR. Display only — the ledger is never touched. Deliberately simple and
  fully visible (formula is in the embed footer) rather than a hidden
  score. Readiness pass rate was *not* blended in: it would make the score
  depend on addon data that isn't reliably flowing yet. Caveat: attendance
  only counts what officers recorded, so members with no records show 0%.
- [x] **P2 / S — Scheduled recruitment auto-post.** *(Done 2026-09-24.)*
  `/config recruitment channel message interval_hours`, checked every 10
  minutes from `main.ts` while the bot is running (`runRecruitmentPosts` in
  `src/services/recruitment.ts`). Because the bot runs from a PC that isn't
  always on, a missed window posts on the next check — it never queues
  catch-up posts. Posts never ping anyone.

### C. Discord housekeeping (Carl-bot parity)

This is genuinely new surface area — none of it existed before Phase 8.
Ordered so each item either stands alone or builds on the previous one.

- [x] **P0 / S — Welcome & farewell messages.** *(Phase 8, done
  2026-09-24)* `/config welcome` / `/config farewell` set a channel +
  optional templated message (`{mention} {username} {guild}
  {membercount}`), posted from `src/services/housekeeping.ts` on
  `GuildMemberAdd`/`GuildMemberRemove` (wired in `src/main.ts`). Default
  welcome template prompts `/apply` or `/character add` directly, tying
  housekeeping into the existing recruitment flow instead of bolting it on.
  Requires the **Server Members Intent** privileged intent enabled in the
  Discord Developer Portal (documented in README) — the bot now requests
  `GatewayIntentBits.GuildMembers`.
- [x] **P0 / S — Auto-role on join + role sync with `/application`.**
  *(Phase 8, done 2026-09-24)* `/config roles` sets an applicant role
  (auto-assigned on join, in `handleMemberJoin`) and a member role
  (auto-assigned, with applicant role removed, when an officer runs
  `/application approve` — see `syncApprovedMemberRoles` called from
  `src/commands/application.ts`). Requires the bot's own Discord role to
  sit above both configured roles or Discord will silently refuse the role
  edit (documented in README); all role operations are wrapped so a
  misconfiguration logs a warning instead of crashing the handler.
  Migration: `20260924115156_phase_8_discord_housekeeping` (adds
  `welcomeChannelId`, `welcomeMessageTemplate`, `farewellChannelId`,
  `farewellMessageTemplate`, `applicantRoleId`, `memberRoleId` to
  `GuildSettings`, all nullable — additive, already applied to the live
  Neon database).
- [x] **P1 / M — Moderation basics + unified audit log.** *(Done
  2026-09-24.)* `/mod warn|timeout|kick|ban|history` (officers). Extended the
  existing `AuditAction` enum with `MODERATION_*` values, so moderation
  lands in the same `AuditLog` as EPGP/config/import actions; `history`
  reads it back per member. Refuses up front per Discord's role hierarchy
  (`hierarchyError`, unit-tested) and requires a reason. Bans work on users
  who already left. Uses slash commands rather than `/warn` etc. as
  top-level names, to keep the command list tidy.
- [x] **P1 / M — Reaction roles.** *(Done 2026-09-24, as buttons.)*
  `/selfroles` posts a panel of buttons that toggle roles. Chose buttons over
  emoji reactions: they need no extra gateway intents or partials, and the
  button's custom id carries the role so no database table is needed. Roles
  with moderation/management permissions, managed roles, and @everyone are
  refused (`selfRoleProblem`), re-checked on every press in case the role
  changed after the panel was posted.
- [~] **P2 / S — Message edit/delete + join/leave logging channel.**
  *(Partly done 2026-09-24.)* `/config log-channel` receives member
  joins/leaves and every `/mod` action. **Not built: message edit/delete
  logs** — Discord only includes message content for those events with the
  privileged Message Content intent, which would need another Developer
  Portal toggle and an intent request. Worth it only if the guild asks.
- [x] **P2 / S — Custom commands/tags.** *(Done 2026-09-24, as slash
  commands.)* `/tag show|list|set|delete`; officers write, everyone reads.
  Tag text is posted with mentions disabled. A `!prefix` command style would
  need the Message Content intent, so slash commands it is.
- [ ] **P3 / S — Starboard.** Fun/engagement feature, not core to guild
  management. Would need message-reaction intents. Backlog — do last, if at
  all.

### Open questions to resolve before implementation starts

These are product decisions, not technical ones — worth settling with the
guild before picking up Part 2 work:

1. **Replace Carl-bot entirely, or run alongside it?** Changes how much of
   section C is actually worth building. If Carl-bot stays for
   moderation/reaction-roles and Guilded stays guild-management-only,
   most of section C can be dropped or deprioritized.
2. ~~How much automatic addon-comms sync is acceptable?~~ **Resolved
   2026-09-24: as much as possible.** See decision log.
3. **Attunements for which content?** WoW Forever's ruleset determines
   which attunement chains actually matter; the attunement list itself
   needs to come from the guild, not be guessed.

### Decision log

- **SUPERSEDED (2026-09-24): "this client lacks spec and item-level
  APIs."** That claim (below, and in the Phase 10 notes) assumed interface
  11200 meant a vanilla 1.12 client. It doesn't. Per Blizzard's WoW UI
  Discord statement (via [Wowhead](https://www.wowhead.com/news/wow-forever-will-have-addon-changes-from-midnight)),
  WoW Forever "shares Mainline WoW's UI architecture, including the vast
  majority of APIs available in 12.1.5", the Midnight addon disarmament
  (secret values, restrictions on computational addons) is active in
  Forever, and Classic-era addons generally need rebuilding for the new API.
  Consequences for this project: (1) the combat-log registration that caused
  the live popup was never going to work; (2) `GetAverageItemLevel` is now
  tried (guarded) in `/guilded inspect`, so readiness reports may carry item
  level after all; (3) spec detection is worth re-checking once someone can
  test whether Forever exposes specialization APIs; (4) new addon features
  should be checked against the 12.x API-change list *before* being built,
  not after. The addon never used Classic-only APIs (it was modern-first
  with guarded legacy fallbacks), so no rewrite is needed. Still to do: set
  `## Interface:` in the `.toc` to Forever's real number. **Done:** it is
  `16001` (from `/dump select(4, GetBuildInfo())` in game); `.toc` and
  `validate-addon.mjs` updated, and the login "out of date" warning is gone.
- **"As much addon sync as possible," resolved 2026-09-24 — implemented
  same day.** User's direction superseded the earlier "event-triggered,
  not continuous" caution — see section A below for what shipped: a
  compact readiness/profession digest now auto-broadcasts to the whole
  online guild (not just the raid group) on login, on every gear change,
  and every 10 minutes while raiding, and every online client accumulates
  everyone else's digests into `db.peerRoster`. This means one officer's
  `/guilded export` now carries a live readiness picture for the whole online
  guild, not just themselves — the actual Guild-OS-parity outcome, achieved
  without the chunked-message protocol Guild OS needs, because the digest
  (status/missing-count/durability/professions, no item list) fits in one
  unchunked addon message.
- **Loot council vs. GP auction, resolved 2026-09-24:** GP/EPGP auction
  only — no loot council mode. Removed the loot-council backlog items from
  sections A and B entirely (not deferred, dropped). `/loot auction` stays
  the one and only loot-distribution path.
- **Open question (formerly numbered 3), resolved 2026-09-24:** automate
  self-observation data
  only (gear, professions, attunement completion); keep everything that
  moves currency or an official record (EPGP, attendance's final record,
  loot awards, application decisions) manual, no exceptions. Reasoning: the
  addon's original "hints, not proof" caution exists for *inferring* facts
  about other players from ambient signals (combat log, loot chat), which
  is genuinely unreliable — it doesn't apply to a player's own gear/
  profession self-report, which is the same trust level as the existing
  manual `/guilded inspect`, just automated. Scope trims that fell out of this,
  based on what the target client (interface 11200 = vanilla 1.12) can
  actually do: no spec auto-detection (no talent-spec API exists pre-MoP;
  `Character.spec` stays the existing manual free-text field) and no item
  level capture (`GetAverageItemLevel` doesn't exist on this client either
  — the addon already correctly never attempted this). Broadcasts should be
  event-triggered (login, gear change, entering a raid), not a continuous
  timer loop — avoids needing Guild OS's chunked-message engineering for a
  v1.

### Suggested phase order

- [x] **Phase 8:** Section C's two P0 items (welcome/farewell + auto-role/
  application sync) — done 2026-09-24. **Still needs a real Discord Server
  Members Intent toggle + a live join/leave/approve test** before trusting
  it in production; nothing in this session could exercise that.
- [x] **Phase 9:** Section B's P0 item (raid signup caps + auto-lock, plus
  the signup-channel embed) — done 2026-09-24. **Not yet manually tested in
  a real Discord raid signup channel** — verify the embed renders and
  updates correctly, and that role caps behave as expected with real
  concurrent signups, before relying on it for an actual raid.
- [x] **Phase 10:** Section A's two P0 items, full scope — done
  2026-09-24. Attunement tracking, profession auto-sync, and (per "as much
  sync as possible") automatic guild-wide readiness/profession digest
  broadcast + peer-roster accumulation. Also fixed the critical Lua-array
  decoding bug described in Section A. **Not yet manually tested against a
  real WoW client** — the Lua-side logic (event triggers, debounce timing,
  `SendAddonMessage` behavior under real raid load) has not been run in the
  actual game, only reasoned through and, for the companion-watcher half,
  verified against a realistic fixture.
- [~] **Phase 11:** Remaining P1/P2 items. **All bot-side items done
  2026-09-24** while the WoW servers were down (Merit-style score,
  moderation + unified audit log, self-role buttons, log channel, tags,
  wishlist bot-side, recruitment auto-post) — unit-tested but **not yet run
  against live Discord**, so the first real test still needs doing: `/mod`
  against a real member, a `/selfroles` panel press, a `/config recruitment`
  post, and `/tag`. **Still open, all addon-side and deliberately not
  started** (can't be exercised without a live client, and the addon has an
  unresolved live bug): attendance from raid presence, buff/cooldown
  coverage, the in-game half of the wishlist, and the minimap button. No
  loot council work — that's fully out of scope, not just deprioritized.
- [ ] **Backlog:** Starboard; message edit/delete logging (both need extra
  privileged/reaction intents); anything from the Warcraft Logs/dashboard
  discussion (held until it's confirmed WoW Forever logs upload to WCL).

- 2026-09-26 Full rename to Guilded: addon folder `Guilded`, saved variable `GuildedDB` (old `QuebecGoldDB` adopted once), `/guilded` and `/gd` replace `/qg`, `[Guilded]` chat prefix, `guilded-*` channel names, package and deploy names. Kept on purpose: Postgres DB `quebec_gold`, backup file prefix, `qg:` import refs and `QG-` run ids (stored data).
