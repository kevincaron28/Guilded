> Current launch audit: [28 October final audit](docs/FINAL_8_0_1_AUDIT_2026-10-28.md). Historical proposals below do not override that feature inventory or the owner’s testing waiver.

# Guilded roadmap

## Current stage — 30 October 2026

Guilded **8.1.0 Candidate** (protocol 2), prepared for November 4: RCLootCouncil/Gargul history conversion, reviewed in-game confirmation, separate persistent history and undo, raid-signup presentation and public-origin reliability. See [candidate gates](docs/NOV4_RELEASE_CANDIDATE.md). Kevin selected five additional pre-launch features for work on October 30; their implementation and acceptance are tracked below, not claimed complete. Published downloads remain 8.0.2.

## Selected pre-launch work — 30 October 2026

These numbers refer to Kevin's seven-item feature discussion, not the older lists
below. Kevin subsequently targeted a product release today, October 30, and asked
for a whole-product gap review before finalizing scope. WoW Forever opens November 4.
The feature branch is held for review/PC-owner coordination, not a release promise.
See [scope, reuse audit and acceptance checklist](docs/PRELAUNCH_COMMUNITY_2026-10-30.md).

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

Published baseline: 8.0.0: security, reliability, ledger storage compaction, versioned Retail overtime scoring, origin isolation, French indexing, accessibility and Core presentation extraction. See [8.0 readiness](docs/V8_0_LAUNCH_READINESS.md) for publication gates and the owner's testing waiver.

Previous published 7.5.1: loot rules follow the original EPGP/soft-reserve rules, guild directory and player search, and Codex's dungeon evidence work (Season 1 stays on current-v1).
Previous: 7.5.0, combining the release-gap bundle and Claude’s raid/interaction fixes.
The original 8.0 baseline passed combined CI, backups, deployment and publication gates. Its retained downloads and earlier evidence are in [8.0 release evidence](docs/V8_0_RELEASE_EVIDENCE_2026-10-28.md).
Real-client checks remain post-release follow-up; see [the release decision](docs/RELEASE_DECISION_2026-10-25.md).
Current gates and completed operational checks: [launch readiness](docs/LAUNCH_READINESS_2026-10-24.md).
GitHub and CurseForge publish 8.0.2 for all five editions and the bot runs its reviewed source. All ten approved CurseForge files match GitHub. Store Submission 4 publishes 8.0.2.0; its actual installed signature, submitted application bytes and retained encrypted profile/account activation passed. See [current provider evidence](docs/V8_0_2_RELEASE_EVIDENCE_2026-10-28.md). Previously both addon providers published 7.5.0;
see [the publication record](docs/RELEASE_EXECUTION_2026-10-25.md). All six
18-October requests shipped in 7.0.0; 7.1.0 added monthly boards and Raider.IO-style leaderboards,
7.2.0 companion Sign in with Discord and one-click updates, 7.2.1 a steadier bot, 7.3.0 the dungeon
result card, raid vacancies and public player profiles, 7.3.1 level-aware raid readiness and the
companion updater repair.

WoW Forever launches **4 November 2026** at 3 PM Pacific; dungeon Season 1 starts at the same
moment (23:00 UTC, `/guilded-season`). The beta closed on 21 October, so the real-client checks
still owed — G6-G8 (dungeon runs), G10 (French client) and the 6.1.2 parts of G2/G12 — can only
run on live servers; see [the 6.2 game acceptance record](docs/V6_2_GAME_ACCEPTANCE.md). Forever's
first raids (Barrow Deeps, 10 players; Hyjal Summit, 20) open on 9 December. Launch-week priorities
and the competitive review: [PRE_RELEASE_AUDIT_2026-10-22.md](docs/PRE_RELEASE_AUDIT_2026-10-22.md).

## Built

- WoW addon: raid attendance, EPGP, GP bids, council, soft reserves, priority loot,
  recipes, guild map, readiness, calendar integration where the client supports it,
  dungeon scores, games and backups.
- Discord bot: setup wizard, cores and signups, standings, personal pairing,
  crafting, onboarding, community seasons/activities, participation and PoE2 journals.
- Desktop and browser companions: personal uploads and standings; desktop file
  watching and optional PoE2 log tracking.

Built does not mean every live workflow has passed. Recorded two-player results
cover map visibility/privacy, recipes, bidding/council/reserves, GP accounting and
sync. Fresh-guild setup, installation/recovery, concurrency, permissions and a
full raid still have outstanding acceptance checks.

## Next

Candidate feature progress while the game is closed: [raid presets, signup layouts,
score cards and quieter companion sync](docs/PRELAUNCH_FEATURES_2026-10-24.md).
Game acceptance starts when access returns. The owner authorized 7.3.2 publication
before those checks; the subsequent feature bundle shipped in 7.4.0 and 7.5.0.

New local review bundle: [roster, crafting, teams, history, groups, main/alt and
limited GRM review, opt-in availability, local activity heatmap and Retail key
sharing](docs/LOCAL_FEATURE_BUNDLE_2026-10-25.md). This bundle is published;
game validation remains pending. Claude's live checks are in the
[post-release review](docs/POST_RELEASE_REVIEW_2026-10-26.md).

1. Make independent guild setup clear and rehearse a clean install. Aim for
   30 minutes with hosting/database/DNS ready; see [QUICK_START.md](docs/QUICK_START.md).
2. Test a genuinely fresh Discord guild and an ordinary member, and complete
   the Windows clean-install/upgrade/recovery checks.
3. Finish the real-client checklist and real raid, verify final-commit CI,
   then publish/promote matching packages as appropriate to the evidence.

## Website — 16 October 2026

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

## Requested — 18 October 2026

In suggested order: quick wins first, then things that build on each other.
How each one gets built: [ROADMAP_REQUESTS_PLAN_2026-10-18.md](docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md).

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
   ([NOVEMBER_DUNGEON_CATALOG.md](docs/NOVEMBER_DUNGEON_CATALOG.md)) proposes a
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

## Requested candidates — 25 October 2026

Current local implementation: [integrated candidate and remaining scope](docs/LOCAL_FEATURE_COMPLETION_2026-10-25.md).
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
[feature candidate review](docs/FEATURE_CANDIDATE_REVIEW_2026-10-25.md).
The owner subsequently authorized starting implementation, kept local for review.
The first addition is the signed-in officer roster dashboard described there;
it and the subsequent feature bundle shipped before 8.0. The documentation-only restriction below describes the
original handoff, not this later local implementation authorization.

| Candidate | Existing Guilded overlap and deferred scope |
| --- | --- |
| Guild dashboard | Cards for total members, active this week, max-level members and vitality; class/race/level/profession breakdowns and activity/inactivity distribution. Filters: Everyone, Max level, Active 30d, Mains only. Define vitality, activity sources, freshness and edition-specific level caps first. Extend existing addon spreadsheet, companion CSV and officer exports; exports are already built ([export plan](docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md#2-spreadsheet-export--built-game-companion-bot)). |
| Guild group board and native finder integration | One board with role, dungeon, key-level and needs-tank/healer filters, complementing Blizzard Group Finder where supported. Existing Discord group posts/queue live in `src/services/dungeon-group.ts` and `dungeon-group-queue.ts`. Reconcile the previously removed duplicate in-game finder before implementation: restoring it requires an explicit scope decision. Native finder integration feasibility is UNKNOWN. |
| Who's Free, keys and alts | Availability with automatic busy status while in instances; keystone and alt lists. Compare current group queues and character links before designing a new store. Decide opt-in visibility, stale/offline status and how availability is sourced. Instance detection and key APIs across clients are UNKNOWN until researched and tested. |
| Multiple raid teams and attendance | Core/Trial/Bench roles, schedules, missing raid buffs and attendance assigned to the correct team with alt credit to mains. Build on existing bot cores, signups, roster and attendance ([core planning and raid-night tools](docs/V6_5_0_RELEASE_NOTES.md)); verify exact gaps first. Automatic attribution and buff checks need client evidence. Reconcile the [retired addon raid-tool scope](docs/archive/raid-tools/README.md) and separate Pullscript project before expanding addon responsibilities. |
| Online activity heatmap | The local hour-by-weekday view on each player's PC is built (addon Availability page). A guild-wide web heatmap was declined by the owner on 26 October 2026: activity samples stay on each player's PC. |
| Guild crafter lookup | Recipe/item search for guild crafters and possible profession-window integration. Recipes/crafting already exist (`addon/Guilded/Modules/Recipes.lua`, `src/services/recipes.ts`, `src/services/craft.ts`); compare their search and sharing flows before marking gaps. Profession-window integration and edition-specific recipe APIs are UNKNOWN. |
| Searchable roster and history | Extend existing character main-alt links, roster views/exports and history rather than duplicate identities. Review search/filter gaps and history coverage; preserve Forever first/last names and Blizzard realm identity. |
| Reviewed officer bulk actions and GRM imports | Candidate design only. Define preview, permissions, conflict handling, audit and recovery before any implementation. No bulk actions are authorized by this entry. Investigate GRM import format, provenance, consent and compatibility; do not assume a supported import path exists. |
| Shared data and local privacy | Reuse the existing paced guild addon-message transport in `addon/Guilded/Util.lua`. Team edits require officer authorization; private notes/settings remain local. Define field-level privacy, authority/conflict rules, data sources, freshness, retention/deletion and upload/publication boundaries before expanding synchronization. |
| Edition gates and feasibility | The reference omits M+ for Forever. Gate Retail/M+ candidates to supported clients and preserve guild/edition separation throughout the addon, bot and companion, including several editions in one Discord server. API availability, combat restrictions, native finder integration and profession integration remain UNKNOWN until researched and tested in each relevant client. |

These comparisons identify reuse opportunities, not new acceptance evidence.
The original backlog handoff authorized only capture. Kevin subsequently authorized
local implementation; see [the local bundle](docs/LOCAL_FEATURE_BUNDLE_2026-10-25.md)
for completed work and remaining scope. Game actions, commits, publication, push,
merge and deployment remain outside this local review pass.

## Commands — 18 October 2026

1. **Done in 6.7.0.** Members see only their commands; leader and officer tools moved to
   `/lead`, `/officer` and `/organize`, and `/setup` warns when a role can't see them.
2. **Done in 7.3.0 where Discord's limits allow.** `/system` and `/uninstall` are now
   `/setup system` and `/setup uninstall`; `/profile` is `/character profile` (27 to 24 top-level
   commands). Kept on purpose: `/config` (with it, `/setup` would be about 4,150 of Discord's 4,000
   characters; it left `/setup` on 8 October for that reason), `/team` (with `/core` about 4,980),
   and `/tag` (`/tag show` and `list` are for members, and `/mod` is hidden from members).
3. **Then.** Drop slash commands that only repeat a button (for example `/raid signup`,
   `/community lottery join`, `/craft claim`) once each button is confirmed to work in Discord.

## Later

- The raid-leader addon is **Pullscript** (a separate project in the owner's `Wow Addons`
  workspace, CurseForge project 1729283): target icons and world markers, tank marking, boss
  plans shared to the group or posted in chat, pull timer and ready check, and a read-only import
  of Guilded's old `raidPlans`. On 20 October 2026 it gained the last two features of Guilded's
  [raid tools archive](docs/archive/raid-tools/README.md): clearing every group icon and marking a
  target by command (local 0.1.0-beta.14; not yet released, real-client checks pending).
- Additional standalone-first-run improvements described in
  [STANDALONE_ADDON_ROADMAP.md](docs/STANDALONE_ADDON_ROADMAP.md).
- Managed multi-guild hosting is now planned through item 4 of "Requested"
  (automatic joining with a lite version); self-hosting stays supported.

Historical feature plans are in [the roadmap archive](docs/archive/ROADMAP-history.md)
and version handoffs. Their old version numbers and pending-test statements
must not override the current release testing record.

## Community achievements implementation — 27 October 2026

The requested 100/300/500 badge shelves, silent legacy baseline, reviewed helper/event
achievements and scoped congratulations are implemented in the badge change.
See [implementation and rollout](docs/COMMUNITY_ACHIEVEMENTS_2026-10-27.md) for privacy,
transaction/delivery guarantees, activation gates and the deferred max-level evidence
requirement. The badge implementation is deployed and retained in 8.0. Per-guild activation and legacy baseline rules still apply; game acceptance is separate. Dungeon integrity and shared transport also shipped before/in 8.0.

## Dungeon integrity draft - 27 October 2026

The first tranche fixes DPS/DAMAGER role parity across both addons, companion and score views; newly frozen official seasons require current evidence while old snapshots and Beta history remain readable. See [implementation, proposed versioned policies and remaining launch checks](docs/DUNGEON_INTEGRITY_2026-10-27.md). The implemented role/evidence corrections shipped before 8.0 and are retained in its published packages. Season 1 uses current-v1; timer/presence/finality alternatives in the design record remain proposals, not silently enabled policies. Real-game validation is still outstanding; historical scores were not reset.
