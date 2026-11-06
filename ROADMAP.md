# Guilded roadmap

## Current stage — 6 November 2026

Guilded **8.4.7** is published on GitHub and the bot (Forever dungeon final-boss fix and the self-updating direct-download companion); the next release is 8.5.0 (planned below).
WoW Forever (level cap 60) launched 4 November 2026; its first raids open 9 December.
Forever is the only active edition and PoE2 is hidden ([Forever-only focus](docs/FOREVER_ONLY_FOCUS.md)).
Release history: [CHANGELOG.md](CHANGELOG.md). Older roadmap text, including every finished
request list: [roadmap history](docs/archive/ROADMAP-history.md).

## How to work from this file (any AI session)

1. Read `CLAUDE.md` first (checks to run, command-size limit, French rules, migrations, never start the bot).
2. Pick **one track** below. A track owns the files listed under it; do not edit another track's
   files. If you must, stop and report to the coordinating session instead.
3. Each item lists **Existing** (reuse it, don't rebuild it), **Build**, **Done when** and any
   **Owner decision** still open. If an owner decision is open, build the default written there,
   behind a setting, and say so in the PR.
4. Shared files every track may touch, carefully:
   - `prisma/schema.prisma`: add your models at the end under a `// 8.5 track X` comment. Use only
     your track's migration timestamp (table below), so folders never collide.
   - `src/i18n-fr.ts`, `addon/Guilded/Locale.lua`: append your keys in one block marked with your
     track. Merge conflicts there are expected and easy.
   - `src/setup-names.ts`: only tracks B and C add channels.
   - Never edit `package.json`'s version, `CHANGELOG.md`, `README.md`'s current version line or
     the `.toc` versions. The coordinating session bumps to 8.5.0 once, at release.
5. **Owner decision (6 November 2026): every new 8.5 feature is ON by default in every Discord
   server** (boards, nickname sync, Who's who, roster gaps, Defender alerts, profession posts,
   statistics, the guildmate map, the first-link DM). Each one keeps an off switch for officers
   (server-wide) and, where it is about a member, for that member. Features that need a channel use
   the channel `/setup` creates or adopts; nothing posts until that channel exists.
6. One PR per track against `main`, green on all four checks in CLAUDE.md. Then report back to the
   coordinating session with the PR link, what was verified, and what still needs a real game client.

| Track | Theme | Migration timestamp | Main areas |
| --- | --- | --- | --- |
| A | Achievements and badges cleanup | none expected | `src/services/achievement*.ts`, `achievements-catalogue.ts` |
| B | Leaderboard boards: race to 60 and the arena/PvP ladder | `20261219000000` | new `src/services/*-board.ts`, PvP setup channels, `addon/.../Battleground.lua` |
| C | Roster and membership: who's missing, character names, roster visual | `20261220000000` | `roster-*.ts`, `guild-health.ts`, new nickname and roster-gap services |
| D | Artisans' Gallery and crafter "last seen" | `20261221000000` | `craft*.ts`, `profession-*.ts`, `recipes.ts`, gallery web page |
| E | Addon quality of life: chat tab, minimap, tooltip last seen | none | `addon/Guilded/Modules/ChatTab.lua`, `Minimap.lua`, `Tooltip.lua`, `Recipes.lua` |
| F | Companion: problem alerts, simpler settings, linking, fresh install | none expected | `companion-app/`, `companion/`, member install docs |
| G | Server and guild statistics with graphs and Google Sheets | `20261222000000` | new `stat-snapshot` service, owner/guild tools web page |
| H | Ideas from Kinfolk Guild Hub (later) | n/a | design notes only until picked |
| I | WoW Forever armory: spike, then links or lookups | none until the spike | new `docs/FOREVER_ARMORY.md`, later a small `armory.ts` service |
| J | Call for help (world PvP) | none expected | new `addon/Guilded/Modules/CallForHelp.lua`; companion chat-log watcher later |
| K | Addon-only members still sync | none expected | `LedgerSync.lua`, `LedgerRelay.lua`, `Digest.lua`, `character-verify.ts` |

C4 and C5 (roster professions, promotion panel) belong to track C; E4 (companion link in game)
belongs to track E. They were added after wave 1 started, so they ship as follow-up PRs.

Suggested order if one session does everything: A, C, E, B, D, F, G. Tracks are independent
except where noted, so they can run at the same time.

---

## 8.5.0 — requested 6 November 2026

### Track A — Achievements and badges

**A1. Every achievement has a badge.**
- Existing: badge art is generated as SVG by `src/services/achievement-badges.ts` from a glyph map,
  with tier frames and locked silhouettes; previews in `marketing/achievements-preview/`.
  The 8.4.5 achievements (duels, PvP, first dungeon clears) were added after most glyphs.
- Build: give each catalogue row a deliberate glyph (no fallback glyph). Add a test that fails when a
  catalogue id has no explicit glyph entry. Regenerate the preview sheet.
- Done when: the test passes and the preview sheet shows every active achievement with its own art.

**A2. Achievements are Forever and guild only.**
- Existing: `achievements-catalogue.ts` (catalogue version 6) has `wow | poe2 | guild` rows and
  per-edition rows for Era, TBC, Mists and Retail. Today they are only hidden by the
  `active-editions` / `active-games` switches.
- Build: catalogue version 7 contains only Forever (`wow-forever-*`) and guild rows. Move the removed
  ids to a `RETIRED_ACHIEVEMENT_IDS` list so they are never reused, keep earned `MemberAchievement`
  rows in the database (history and the switch back stay possible), and stop the web page, cards,
  `/achievements` and announcements from showing retired rows even when a switch is turned back on.
  Update `docs/ACHIEVEMENTS.md` and `docs/FOREVER_ONLY_FOCUS.md` (how to restore an edition's rows).
- Done when: no PoE2/Era/TBC/Mists/Retail achievement appears anywhere a member can see; counts in
  `docs/ACHIEVEMENTS.md` match the catalogue; existing earned rows are untouched.

### Track B — Boards: race to 60 and the arena ladder

Both boards copy the **duel board pattern** (`src/services/duel-board.ts`): one bot message edited in
place, a marker, a pure embed/card builder, refresh through `discord-jobs.ts`, opt-in per server.
Render images with `src/services/score-card.ts` (roster layout) so they match the other cards.

**B1. Leveling leaderboard, "race to 60".**
- Existing: `Character.level` from uploads; level milestones every 10 levels (`Milestones.lua` →
  `MemberMilestone`), achievements `wow-forever-level-N`. The officer's addon upload also sees levels
  of guildmates who never linked (`UnclaimedCharacter.level`).
- **Owner request (6 November 2026):** the `race-to-60` channel shows a leaderboard of the **top 25
  guild characters** (officers can set 10-30) with, per row: rank, character first and last name,
  class (class colour and icon), race, level with a progress bar and % to next level when known,
  professions with skill, last seen, the linked Discord member, and, for those at 60, the date they
  reached it (finish order). Below it: "levels gained this week" top 5 and the guild's count of 60s.
- **Hall of Fame (owner request, 6 November 2026):** the channel is kept after the race. Each time a
  guild character reaches 60, the bot posts a **permanent Hall of Fame entry** in the channel (number
  in order, e.g. "#7 to reach 60", name, class, race, date, days since first seen in the guild,
  professions, linked member) that is never edited or deleted, and stores it in the database so the
  history survives channel resets. The live top-25 board stays the channel's first message. When an
  officer ends the race (`/officer race end`) or everyone tracked is 60, the board switches to Hall of
  Fame mode: every level 60 in the order they arrived.
- Build: a permanent board in a `race-to-60` channel (or a channel the officer picks): every guild
  character ordered by level, class-coloured progress bars, time each one reached 60 (finish order),
  "levels gained this week". Linked and unlinked characters both count (unlinked shown by character
  name only). Members can hide their characters (`/character privacy` or a button). Optional "Near
  your level" line per member for finding levelling partners (idea from track H).
- Done when: board appears after opt-in, updates within one sync of a level change, survives a bot
  restart without duplicating, French text present.

**B2. Arena ladder and the PvP channels.**
- Existing: battleground module (`src/commands/battleground.ts`, `battleground-*.ts`,
  `BattlegroundReport`, addon `Modules/Battleground.lua`, docs `BATTLEGROUNDS_NEXT_MODULE.md` and
  `BATTLEGROUND_CAPTURE_PILOT.md`), duels and the duel board. Its channels (`BG_SETUP_NAMES`:
  `battleground-groups`, `battleground-results`, `battleground-statistics`) are an optional module that
  normal `/setup` does not create. No arena code exists.
- Step 0 (blocks the arena half): confirm in the live Forever client whether rated or skirmish arenas
  exist (`GetBattlefieldArenaFaction`, `GetBattlefieldTeamInfo`, `IsActiveBattlefieldArena`). Record
  the answer in `docs/BATTLEGROUNDS_NEXT_MODULE.md`.
- Build, PvP channels (do now): one **PvP** category created by `/setup` when the module is switched on:
  `pvp-groups`, `pvp-results`, `pvp-ladder` (permanent boards: duel board, BG statistics, arena
  ladder) with English and French names in `setup-names.ts`. Existing BG channels are adopted, not
  duplicated.
- Build, arena (if step 0 says arenas exist): addon captures the arena end screen (teams, members,
  win/loss, rating change if the client exposes it) into SavedVariables; companion uploads it;
  `ArenaTeam` and `ArenaMatch` models; both teams' uploads deduplicate one match; ladder by bracket
  (2v2, 3v3, 5v5) using the client's team rating, or a clearly labelled unofficial Guilded rating
  when the client gives none. Board in `pvp-ladder`.
- If arenas do not exist in Forever: the ladder is the PvP ladder (duels plus BG reports) and the
  arena capture waits behind the edition switch.
- Done when: `/setup` creates the PvP category once, the ladder board updates from uploads, and
  `docs/BATTLEGROUNDS_NEXT_MODULE.md` drops its stale 30 October checkpoint header.
- **Owner decision (6 November 2026): two separate ladders, never mixed points.** A **duel ladder**
  (wins/losses, win rate, streak, from `DuelResult`; the existing duel board feeds it) and a
  **battleground ladder** (from battleground reports: games, wins, win rate, kills/honorable kills
  and other stats the capture provides, per bracket), each its own message in `pvp-ladder` with its
  own scoring. Battleground stats stay labelled as player reports, not verified matches.
- **Owner decision (6 November 2026):** "arena module" means the existing **battleground/duel PvP
  module**. Build the PvP channels and the PvP ladder (duels plus battleground reports). Arena
  capture is not part of 8.5; step 0 stays as a note for later.

### Track C — Roster and membership

**C1. In Discord but not in the game guild (invite list).**
- Existing: `Character.guildRankName/guildRankAt/lastSeenAt`, `UnclaimedCharacter` (in guild, not
  linked), `src/services/link-coverage.ts` (local script only), `member-cache.ts`, roster dashboard.
- Build: `/officer roster gaps` (under `/officer`, keep `/setup` within Discord's size limit) and a
  "Discord only" filter on the roster dashboard, listing:
  1. members with a linked Forever character that is **not** in the guild roster (no fresh
     `guildRankAt` within 14 days), each with a copyable `/ginvite First Last` line (Forever
     characters have first **and** last names);
  2. members with no linked character ("ask them to link" button that sends the normal link prompt);
  3. the reverse: guild characters nobody in Discord has claimed (`UnclaimedCharacter`).
  Ignore bots and an officer-chosen list of roles (for example guests).
- Done when: the three lists match a hand check on Québec Gold, and an officer can copy all
  `/ginvite` lines in one click.

**C2. Character names visible in Discord.**
- Existing: `rank-roles.ts` (in-game rank → Discord role, loops guilds with `forEachGuildScope`);
  `/character list @member`. Nothing writes nicknames today.
- Build: opt-in nickname sync. Officer picks a format, default `Discord name (Main First)`, capped at
  32 characters; members can opt out; the bot skips the server owner and anyone above its role and
  needs Manage Nicknames (`/setup` checks it). Also a permanent **Who's who** board (one message,
  duel-board pattern) listing each member with their main and alts, for when nicknames are off.
- Done when: renaming works on a test server, opt-out restores the previous nickname, and the board
  stays one message.
- **Owner decision (6 November 2026):** default format `Discord name (Main First Last)`, for example
  `kevmister28 (Lebowski Holyroller)`, main only. Discord caps nicknames at 32 characters, so fall back
  in order: drop the space before `(`, then shorten the last name (`kevmister28(Lebowski H.)`), then
  first name only (`kevmister28(Lebowski)`); only if that still does not fit, shorten the Discord name
  with `…`. Alts stay on the Who's who board (bots cannot write Discord's personal member notes).

**C3. Visual guild roster (classes and professions).**
- Existing: `/guild-health` text (`buildComposition`, level bands, retention); roster dashboard
  filters and `professionCoverage`; `score-card.ts` roster layout.
- Build: a roster card (image) with class counts by level band (class colours) and a profession grid
  (how many crafters per profession, max skill, gaps), shown by `/guild-health` and as charts on the
  roster dashboard web page. Optional permanent board in an officer channel.
- Done when: card renders for 0, 1 and 150 members without overlap; numbers equal `/guild-health`.

**C4. Professions on the guild roster (requested 6 November 2026).**
- **Recommendation:** show professions in the roster, not in notes by default. Guild notes are 31
  characters, are often already used by other addons or for main/alt names, and editing them
  needs officer permission. Guilded already shares professions by addon message.
- Build: (1) professions and skill as icons in the roster view (C3 web dashboard and the addon's
  roster window) and in the tooltip when hovering a name in Blizzard's guild roster; (2) an
  **opt-in officer tool** "write professions to public notes" using the existing reviewed note
  action (`Modules/RosterTools.lua`, one click per batch): it writes a short tag such as
  `Alch300 Herb300` only into notes that are empty or already carry the Guilded tag, shows a
  preview first, and never touches officer notes.

**C5. Promotion panel: Initiate → Member (requested 6 November 2026).**
- Existing: one-click reviewed promote in the addon (`RosterTools.lua`, `RosterAdmin.lua`); in-game
  rank → Discord role sync (`src/services/rank-roles.ts`); the officer bridge brings bot data into
  the addon.
- Build: officers set the rule with `/officer promotion` (default: in the Discord server, at least one
  linked character, rank "Initiate" for 7+ days; optional minimum level or activity). The bot
  computes **Ready to promote** and **Not in Discord yet**; officers see it as (1) a weekly list in the
  officer channel (opt-in) and (2) an addon **Ready to promote** panel, fed by the officer bridge,
  with one **Promote** click per member. After the in-game promotion, `rank-roles` updates the
  Discord role by itself, so nobody edits roles by hand.
- Done when: the list matches a hand check, and promoting in game changes the Discord role on the
  next sync.

### Track D — Artisans' Gallery and "last seen"

**Recommendation:** one **Artisans' Gallery** built on data we already store, shown in three places,
instead of a new database. Recipes come from `RecipeKnown` (item ids, `scannedAt`), skills from
`ProfessionSkill`, cooldowns from `ProfessionCooldown`, offers from `CraftOffer`.

**D1. Gallery web page** (guild tools site, signed-in members of that guild only): search by item,
reagent or crafter; each recipe shows icon and quality (reuse the item-preview data), every crafter
who knows it, their skill, "last seen", open offers and a **Request** button that creates the normal
craft request. Crafter cards: professions, skill, notable recipes, cooldowns ready.

**D2. Discord:** keep the craft forum. Add one auto-updated post per profession (duel-board pattern,
one message each) listing recipes → crafters with last seen; replace the current top-3 directory text
(`profession-directory.ts`). `/craft who` adds last seen and sorts recently seen crafters first.

**D3. Last seen everywhere.** Use `Character.lastSeenAt` (fallback `RecipeKnown.scannedAt`) in
`findProfessionHolders`, `/craft who`, the directory, the gallery and the in-game tooltip (track E3
reads the same value from the guild roster). Show it as "today", "2 days ago", "3 weeks ago".

- Done when: searching an item finds every crafter who knows it, last seen matches the roster, and
  requests from the gallery land in the existing craft board flow.

### Track E — Addon quality of life

**E1. Guild events in the Guilded chat tab.**
- Existing: `Modules/ChatTab.lua` (tab for Guilded's own output); `GuildLog.lua` (game guild log);
  `Presence.lua`.
- Build: echo guild **join, leave, kick, promote/demote, come online, go offline** into the Guilded
  tab, matched from `CHAT_MSG_SYSTEM` with the game's own global strings (`ERR_GUILD_JOIN_S`,
  `ERR_GUILD_LEAVE_S`, `ERR_FRIEND_ONLINE_SS`, `ERR_FRIEND_OFFLINE_S`, ...) so every locale works, only
  for guild members. Class-coloured names, a timestamp, and a toggle per event type in settings
  (all on by default; online/offline can be set to officers-only view).
- Done when: Lua tests cover the pattern matching for English and French strings; in game the lines
  appear in the tab and not twice in General.

**E2. Minimap button shortcuts.**
- Existing (`Modules/Minimap.lua`, `minimapClick`): left = tools window, right = check my gear,
  alt = guild map, drag = move. Shift and Ctrl unused; only left and right buttons registered.
- Build (proposed, simplest to remember):

  | Click | Opens |
  | --- | --- |
  | Left | Guilded window on the last page used |
  | Right | Quick menu: Raid signups, Loot and standings, Dungeons, Crafting search, Guild map, Race to 60, Settings |
  | Shift + left | Dungeon groups / finder |
  | Ctrl + left | Check my gear (moved from right) |
  | Alt + left | Guild map (unchanged) |
  | Middle | Settings |

  Tooltip lists every shortcut plus live status (sync waiting, unread board posts). Keep the addon
  compartment entry in step with the same actions.
- Done when: every click works out of combat and does nothing protected in combat; tooltip text in
  French too.

**E3. "Last seen" in the Crafted by tooltip.** Read `GetGuildRosterLastOnline` for crafters (online
now = "online"), cache it in SavedVariables with the time it was read, and add it to the compact
Crafted by line (8.4.6 #375) without making the tooltip taller.

**E4. "Get the companion" in game (requested 6 November 2026).** Addons cannot open web pages, so
the addon shows a copy box with the short link (`guilded.kcaron.top/companion/`) and the stable
direct link, on the Home page and in Settings, plus a gentle reminder at most once a week for members
whose characters have not been uploaded by their own companion in 7 days (the officer bridge tells
the addon who that is). The reminder says what syncing gives them and can be turned off.

### Track F — Companion

**F1. Problem alert with the fix and a report to copy.**
- Existing: Activity page, "Review support summary" (`syncDiagnosticPreview`), save diagnostics as a
  file; `companion/sync-status.mjs`; bot error references (`/report bug`).
- Build: a red **!** on the window header and tray icon when a check fails, opening a Problems panel.
  Each problem: one plain sentence, **How to fix** steps, a **Fix it** button where possible, and
  **Copy report for the developer** (the privacy-reviewed summary plus a short reference, copied to
  the clipboard; optional "Send to developer" that files it like `/report bug`). Checks: addon not
  installed or wrong edition folder, saved file missing or not updated after `/reload`, WoW running
  during an update, sign-in expired, upload rejected (with the server's reason), companion outdated,
  no internet / bot unreachable.
- Done when: each check has a unit test that triggers it and a screenshot in the PR.

**F2. Simpler settings.** Keep visible: connection status, Sign in with Discord, WoW saved-data
(Detect/Browse), start with Windows, automatic updates, Check for updates. Move under **Advanced**:
bot address and pairing code ("older companions or your guild's own bot"), Battle.net (already hidden
for Forever), manage devices, reset/remove data, realm and guild filters, interval. Hide pages a
member does not use (Pricing, Cores, Reserves, Wishlist) until the guild uses those features.

**F3. Less friction when linking** (open items 7-10 of
[the member journey audit](docs/MEMBER_JOURNEY_AUDIT_2026-11-05.md)):
- folder picker that starts at the WoW install root and finds the Forever account folder itself,
  including several accounts (pick one per character);
- after the first companion link, a Discord confirmation ("You're linked: First Last, Second Last");
  **owner decision (6 November 2026):** send the member a **DM** (clearer than a delayed line); this
  is an owner-approved automatic message, so it is on by default, once per member, and quiet if
  the member's DMs are closed;
- `/guilded verify`: show "waiting for a guildmate's companion" vs "linked" in game, and keep the code
  in the guild digest until it is heard instead of losing it when nobody is online;
- companion offers to install or update the matching addon (WoW closed check, correct edition folder).

**F5. Store companion updates itself (owner request, 6 November 2026).** Today a Store install
shows a button that opens `ms-windows-store://downloadsandupdates` (`companion-app/main.cjs`), and
Windows' own Store auto-update installs it later, often hours afterwards. Build: when
`process.windowsStore` is true, call the Windows Store API from the packaged app
(`Windows.Services.Store.StoreContext`: `GetAppAndOptionalStorePackageUpdatesAsync`, then
`TrySilentDownloadAndInstallStorePackageUpdatesAsync` on Windows 11 and Windows 10 2004+; on
Windows 10 1607-1909, where the silent call does not exist, `RequestDownloadAndInstallStorePackageUpdatesAsync`,
which shows one small Store "Update" prompt instead of opening the Store; Windows 7/8 cannot run
Store apps or current Electron, so those members use the direct download), at most once every 6 hours
and when WoW is not running, and restart the companion quietly after it closes. Fall back to the
current button when the call is unavailable or fails. Mark future Store submissions' packages as
mandatory in Partner Center so the API reports them as required. Needs a real Store install to
test; the direct-download build already updates itself (8.4.7).

**F4. Fresh computer test.** Run the member path end to end on a clean Windows profile (Windows
Sandbox on the owner's Windows 10 Pro for the companion and folder steps; a real second PC for the
Store and WoW steps). Time each step, screenshot each screen, fix what confuses, and rewrite
`docs/MEMBER_INSTALL.md` (the French paragraph still lists all five editions). Record results in
`docs/FRESH_INSTALL_MEMBER_TEST.md`.
- Done when: a non-technical member can go from the Discord prompt to "Everything is linked" in under
  10 minutes with no question to an officer.

### Track L — Effortless linking (owner request, 6 November 2026)

**Goal:** a member goes from the Discord prompt to "linked, with my characters" in about 2 minutes
alone. Measured on a fresh PC today: about 25 minutes with help, and at least 5 places where a
member alone would stop. The owner's standing preference is the fewest steps, automatic where
possible, with a DM and an undo. Builds on F1-F5; same files (`companion/`, `companion-app/`, site
`/me/companion`, the bot's link-request expiry).

| # | Item | Status |
| --- | --- | --- |
| 1 | Find WoW on any drive (all drives, Battle.net install record, `.build.info`); pick the account `Guilded.lua`; list several if found; say when none; Browse starts at the WoW root | in Track F fix list |
| 2 | Install or update the addon from the companion (checksum-verified), and say when it's missing | done (#403) |
| 3 | Account not in the guild's Discord: detect it, show a **Join Québec Gold** invite button, then continue the link by itself. Later: accept by in-game guild membership | next |
| 4 | "Connected as <name>" with avatar and "Not you? Switch"; sign in through the Discord desktop app when possible | next |
| 5 | Browser opened behind the windows: bring it forward, plus a "Waiting for your browser… Reopen / Copy link" panel and a taskbar flash | in Track F fix list |
| 6 | One Discord click, not two (go straight to sign-in when coming from the companion) | in Track F fix list |
| 7 | Link request lasts 15 min, with a countdown in the companion and on the page and a Restart button | in Track F fix list |
| 8 | Warn ahead about Discord's "new login location" email check; offer QR-code login | next |
| 9 | Never say "Everything is linked" unless Discord, the guild server and at least one character are confirmed; otherwise a checklist (Discord ✓ / server ✗ Join / character ✗ play and `/reload`) | in Track F fix list |
| 10 | One live source of truth for status (companion home, website "Mon Guilded", the browser box) | in Track F fix list |
| 11 | All errors translated, in friendly words ("Guilded's server is restarting, retrying in 1 min") | in Track F fix list |
| 12 | Partial status: upload OK / rankings delayed; server-side issues never turn the member's badge red | next |
| 13 | Explain where characters come from (play with the addon, `/reload`; Battle.net optional on Forever), plus a **Detect now** button that waits for the next save | next |
| 14 | A big success screen mirroring the DM, and in game "Linked to Discord as … ✓" after the first sync | next |
| 15 | First-run wizard, 3 steps (Discord → server → character) with progress; each step has "Something's wrong?" running diagnostics, plus one-click "Copy support summary" | next |

**Done when:** a non-technical member on a fresh PC, with WoW on a non-default drive and a Discord
account that isn't in the guild yet, links without help in about 2 minutes, measured by the
second-PC tester.

### Track G — Server and guild statistics

**Recommendation:** charts on the guild tools web page first, Google Sheets as a live feed, not the
other way round. A Sheets API integration needs Google service-account credentials the repo must not
hold; `IMPORTDATA` needs none.

- Existing: `/stats`, `guild-stats.ts`, `weekly-report.ts`, `/guild-health`, `/officer export` CSVs,
  `MemberActivityTotal`, `CommunityParticipationDay`, companion spreadsheet export.
- Build:
  1. `GuildStatSnapshot`, written once a day per guild: Discord members, members active (messages,
     voice), linked members, guild roster size, online peak (from uploads), level distribution,
     class counts, level 60 count, raids and dungeon runs that day.
  2. A **Statistics** page on the guild tools site with line and bar charts (members over time,
     activity, levels, classes, professions); officers only by default.
  3. A read-only CSV feed per guild (`/officer stats feed` shows the URL with a revocable key) that
     an officer pastes into Google Sheets with `=IMPORTDATA("…")`; Sheets then draws its own graphs.
     Ship a ready-made Sheet template link in the doc.
  4. `/stats server` embed with a small chart image (score-card renderer).
- Done when: 7 days of snapshots draw correctly; the CSV loads in Google Sheets; revoking the key
  stops the feed.
- **Owner decision:** later direct Google Sheets writing (needs a Google Cloud service account the
  owner creates). Not part of 8.5.

### Track H — Ideas from Kinfolk Guild Hub (later; pick before building)

Kinfolk ("KinFolk: Guild Hub", CurseForge, Forever, 0.18.16 on 5 November 2026) is **All Rights
Reserved**: reuse ideas only, never code, text, layout, art or the name. Guilded already matches or
beats it on loot/EPGP, crafting, the Discord bot, linking, dungeon scores, duels and the guild map.
Worth adopting, most useful first:

1. **Events with RSVP in game:** sign up / tentative from the in-game calendar with role and class
   counts, mirrored to the existing Discord raid signups (we have signups; the in-game side is thin).
2. **Recruiting kit:** recruit records, editable interview questions, recruiting posts with a shared
   guild cooldown, building on `/mod recruit` and the officer Prospects window.
3. **Levelling partners:** "near your level and zone" list with a whisper button (folded into B1).
4. **In-game guild board** for officer posts and polls, mirrored from Discord polls.
5. **Per-guild module switches** set by officers (extend the announce off switch).
6. **Short class notes** labelled confirmed or early advice (low priority, content upkeep).

### Track I — WoW Forever armory (spike first; requested 6 November 2026)

Blizzard's Forever armory is live at `worldofwarcraft.blizzard.com/en-us/forever/{us,eu,kr,tw}/armory`
(characters from level 10). What we know: the page is a client-side app; `robots.txt` only blocks
login pages; no public Forever API namespace has been announced, and Blizzard's Profile API never
covered Classic characters before. Character URL pattern, name encoding (Forever first **and** last
names) and guild pages are **unverified**.

**Recommendation:** use it only through an official route, and only as optional enrichment. The addon
and companion stay the source of truth; nothing breaks when the armory is down or changes.

- **I0. Spike (blocks everything else, ~1 hour):**
  1. The owner opens one real Forever character page and one guild page in a browser with DevTools →
     Network, and saves the URL patterns and any JSON request names (no cookies or tokens copied).
  2. With the existing Battle.net developer app (`docs/BATTLENET_SETUP.md`), test whether
     `profile-forever-us` / `dynamic-forever-us` (or similar) namespaces answer for a known character.
  3. Read Blizzard's website and API terms on automated access. Record all three answers in
     `docs/FOREVER_ARMORY.md`.
- **If an official API covers Forever:** (a) `/character link` checks the character exists and shows
  its level, class and guild before saving; (b) a daily guild-roster import fills levels for members
  without the addon (feeds B1 race to 60 and C1 roster gaps); (c) `/armory First Last` lookup and an
  armory link on every character card, profile and the Artisans' Gallery.
- **If only the website exists:** add armory **links** (character cards, `/character list`, gallery,
  race board) and no automated reading. No scraping of undocumented endpoints.
- Battle.net sign-in stays hidden for Forever members until I0 proves it links Forever characters.

### Track J — Call for help (world PvP), requested 6 November 2026

**Goal:** a member being ganked presses one button and the right guildmates know at once, in game
and in Discord.

**Recommendation (who gets alerted):** guildmates with Guilded who opted in as **Defenders**
(default on for level 60s, off below level 40, a member setting), within the same zone, sorted by
distance when the guild map knows both positions. Everyone else in the guild sees one quiet chat line.

- **Existing:** guild map position sharing (`Modules/GuildMap.lua`, default on, paused in instances
  and combat, so the last position before combat is still known); the paced addon-message queue
  (`ns.comm.send`); the Guilded chat tab; Québec Gold's **Blizzard-native guild chat ↔ Discord link**
  (`#chat-guilde`), which already carries guild chat into Discord with no bot involvement.
- **Build, addon:**
  1. Trigger: `/guilded help`, a key binding, the minimap quick menu (E2) and a **Call for help**
     button that appears for 20 s when an enemy player damages you outside a battleground
     (`COMBAT_LOG_EVENT_UNFILTERED`, hostile player source). Never sends by itself.
  2. Message (prefix `GuildedSOS`): caller, zone, subzone, map position if known, level, attacker
     names/classes/levels seen in the combat log, time.
  3. Receivers who are Defenders get a raid-warning-style banner, a sound, distance and direction
     when known, a map pin, and **On my way** / **Can't** buttons; the caller sees who is coming.
     Others get one line in the Guilded chat tab. No secure or protected action (works in combat).
  4. Optional **Also post in guild chat** (caller's choice, default on): one short guild-chat line
     such as `[Guilded] Help! Lebowski is under attack in Duskwood (2 Horde, 58-60)`. Through the
     native link it appears in Discord immediately.
  5. Anti-spam: one call per caller per 2 minutes, an "all clear" button, auto-expiry after 5 minutes.
- **Build, Discord (optional, opt-in per server):** a `@Defenders` role ping in a chosen channel.
  The addon cannot reach Discord itself and SavedVariables are only written on reload or logout, so
  live pings need the companion: it watches the game's chat log file (`Logs/WoWChatLog.txt`, written
  live while `/chatlog` is on) for the `[Guilded] Help!` line and forwards it to the bot.
  Feasibility of the chat log on Forever is step 0 of this part.
- **Done when:** Lua tests cover the trigger, cooldown and receiver filter; in game, two clients in
  the same zone see the banner within 2 seconds; the guild-chat line shows in Québec Gold's Discord.

### Track K — Addon-only members still sync (and sync is as good as other addons)

**Goal:** a member who never installs the companion still has their data (characters, levels,
professions, recipes, dungeon runs, duels, attendance) reach Discord and the website, through any
guildmate whose companion is running.

- **Existing:** member ledger sync on by default (`LedgerSync.lua`, `LedgerDigest.lua`,
  `LedgerRelay.lua`: officer receipts, whisper delivery, digest checks), the officer bridge for the
  other direction (`docs/OFFICER_COMPANION_BRIDGE.md`), `/guilded verify` for linking without a
  companion, and the provisional/trusted upload rules in `src/services/character-verify.ts`.
- **Build:**
  1. Audit, field by field, which member data travels by addon message today and which only leaves
     the PC through that member's own companion. Write the table in `docs/ADDON_ONLY_SYNC.md`.
  2. For each gap, add the field to the guild digest or relay, with provenance (who saw it, when)
     so the bot can mark relayed data "reported by a guildmate" and prefer first-hand uploads.
  3. Compare with how other guild addons sync (findings below) and adopt what is better: chunking,
     throttling, version checks, conflict rules.
  4. Show in game which guildmates have a companion syncing ("Synced via Lebowski, 2 h ago").
- **Done when:** in a two-client test, a member with no companion gets their level, professions and
  a dungeon run onto the website through the other member's companion.

**What other addons do (research 6 November 2026; search snippets, not code review):**
- **GRM** syncs over GUILD addon messages, needs matching versions, sets edit rights by rank, and on
  Retail can no longer edit public/officer notes (it keeps its own "custom note"). Whether Forever
  still allows addon note edits must be tested in game before C4's note tool ships.
- **CEPGP/EPGP** store standings in officer notes, so other addons must never write officer notes.
- **Guildbook, GuildCrafts, Recipe Registry, Profession Master** share professions by addon message
  after each player opens their profession window; none writes notes. GuildCrafts prunes data not
  refreshed in 45 days and notes that GUILD addon messages are not delivered inside instances.
- **No guild addon uploads to a website**; Raider.IO and Warcraft Logs use their own desktop apps.
  So Guilded's companion relay is already ahead. The lesson is to make every relayed record
  self-describing (author, time, id) so the bot can deduplicate and trust first-hand data first.
- Adopt for Guilded: an explicit addon version check with a "please update" line, stale-data pruning
  with a visible age, and queueing sends while in an instance until the player is back outside.
- **Call for help:** WarlordsPvP has a manual SOS (command, minimap click, button) that posts zone,
  coordinates and nearby enemies to guild chat with a 10 s cooldown; Spy2 detects enemies from the
  combat log. No addon alerts opted-in guildmates with a banner and "On my way" replies, so Track J
  would be new. Write it from scratch: these addons are references for ideas only.
- **Promotions:** GRM records promotion dates and has promote macros but no "ready to promote" list,
  so C5 is new work. Test in the Forever client that promoting from an addon click works with the
  officer's Promote permission.

### Release blocker — Forever characters keyed by first name only (found 6 November 2026)

A live two-PC test showed that on WoW Forever every key uses only the first word of a character's
name, so alts that share a first name (the owner's "Lebowski Holyroller", "Lebowski Highspirits"…)
collapse into one entry: ledger account, dungeon runs, duels, recipes, roster, relay, the bot's
`Character` row and every name-keyed table. Track K is switching Forever keys to the full
"First Last" name, with a no-loss migration (dry run first, ambiguous rows flagged for an officer,
legacy ledger history kept on an officer-assigned account) and backward compatibility for 8.4.x
addons. Details: `docs/FOREVER_NAMES.md`. The relink and second-character test waits for it.

### Owner requests, 6 November 2026 (afternoon)

- **Delete the pre-launch season and all beta characters.** They still appear in Québec Gold's professions, the race to 60 and the unlinked characters. Track K is building a cleanup script: preview first, `--apply` after a backup, never touching EP/GP history or Season 1. See `docs/PRELAUNCH_CLEANUP.md`.
- **Crashin's Ragefire run didn't credit Xaldin or El Pirata.** Track J is investigating how party members get run credit (linking, two-word names, validation) and will fix it.

### Release step — in-game testing by desktop control

After the track PRs are merged into the 8.5 candidate, one Sonnet tester session runs
[the 8.5 game test plan](docs/V8_5_0_GAME_TEST_PLAN.md) on the owner's PC: WoW Forever in windowed
mode, entering from the character screen as Lebowski Holyroller. To save cost it reads the chat
log, saved data and Discord page text, and takes about a dozen screenshots in total.

### Final phase 1 — new screenshots and website refresh (after all tracks are merged)

Owner request, 6 November 2026. Once 8.5.0 is feature-complete:
1. Take fresh screenshots in game (race board, PvP ladder, call for help banner, chat tab, minimap
   menu, roster card, Artisans' Gallery, companion Problems panel and settings) and in Discord.
   Sanitize names that are not Québec Gold members.
2. Update guilded.kcaron.top and kcaron.top: features page, guides (`docs/MEMBER_INSTALL.md`,
   `docs/QUICK_START.md`), companion page (Store self-update, direct download), FAQ and `/help`.
   English and French. Merges to `main` publish the site.

### Final phase 2 — the phone app as a "glance and group" companion (Track M)

Owner request, 6 November 2026: an app to check leaderboards at work and to help group while playing.
- **Existing (`mobile/`, Expo, preview APK 0.2.0 live):** public leaderboards; companion sign-in for
  characters, reserves, wishlist, raid standings and on-device reminders. PR #345 adds the server
  side for mobile alerts and sign-in renewal.
- **Build:**
  1. **Leaderboards first:** dungeon season, race to 60, PvP ladder, duels, achievements; fast,
     cached, readable in 5 seconds.
  2. **Guild view:** roster with class/level/professions, who is online now, last seen, mains and alts,
     the Artisans' Gallery search.
  3. **World map of guildmates:** last known position of guildmates who share their map position,
     shown as dots, with a **last-seen heatmap** of where the guild plays. **Owner decision
     (6 November 2026): approved, on by default.** Each member can turn sharing off, only
     signed-in members of the same guild see it, it is never public, and a member who turns it off
     has their stored positions deleted. (This is separate from the 26 October refusal of a
     guild-wide activity-time heatmap, which still stands.) Positions only reach the bot
     when a companion uploads (at reload or logout), so they are "last seen", not live, unless the
     companion chat-log watcher from Track J is built.
  4. **Call for help on the map:** active calls from Track J shown as pins with time and attackers;
     push notification to Defenders who opted in on the phone.
  5. **Dungeon and group notifications:** a group needs your role, a vacancy in a raid you signed up
     for, your dungeon run counted, someone in the guild beat your score. Each one off/on per member.
- Ship as the next APK after PR #345 is merged, then Google Play.

### Release step — bring the Québec Gold Discord up to date (owner request, 6 November 2026)

After 8.5.0 is merged and deployed, the coordinating session turns the new features on in the
Québec Gold server and checks each one live. Opt-in switches stay off for every other server.
1. Re-run `/setup` so the PvP category (`pvp-groups`, `pvp-results`, `pvp-ladder`) and the race-to-60
   channel exist; existing battleground channels are adopted, not duplicated.
2. Turn on and check: race-to-60 board, PvP ladder board, Who's who board, nickname sync
   (`kevmister28 (Lebowski Holyroller)` style; check Manage Nicknames and role order first),
   profession posts / Artisans' Gallery, statistics snapshots and the Sheets feed.
3. Run `/officer roster gaps` and hand the `/ginvite` list to an officer.
4. Check that `/achievements` and the web page show only Forever and guild achievements.
5. Update pinned guides and the bot-guide channel text where commands changed; record the results
   in `docs/V8_5_0_RELEASE_ACCEPTANCE.md`.

---

## Carried over (still open from 8.4)

- **8.4.7 distribution** (GitHub v8.4.7 and the bot at `06f12f1` are live):
  - CurseForge: upload the `Guilded-v8.4.7-forever.zip` (project 1712677, display name
    "Guilded 8.4.7 (WoW Forever)") and `GuildedDungeons-v8.4.7-forever.zip` (1754138). Both are in
    `C:\Users\Kev\Desktop\guilded-release-8.4.7\`. Game version 1.60.1 only, release type Release.
  - Microsoft Store: after Submission 11 (8.4.6.0) certifies, submit
    `Guilded.Companion.8.4.7.x64.STORE-SUBMISSION.msix` (8.4.7.0); upload trick in the
    `release-8-4-6` memory note.
  - Site pointer PR #388 (releases.json → 8.4.7): its Cloudflare preview build failed; rerun, then merge.
  - Existing direct-download companions need one manual update to reach the self-updating 8.4.7.
- **Dungeons:** unknown Forever final bosses log `DUNGEON_FINAL_UNMATCHED`. Add their ids as they
  appear. For 8.5 the owner leans toward **dungeon Season 2 on current-v2 rules** (Season 1 stays
  current-v1; the level-60 Best 8 is implemented but inactive). This needs a decision on the start
  date before it is built.

- **WoW-linked Discord item previews** in the Blizzard-linked guild chat channel: built off by
  default (`docs/ITEM_PREVIEWS.md`, `src/services/item-preview.ts`); webhook posting and non-echo
  into WoW still unproven live. Do not change the native Blizzard relay.
- **Crafter offers** (`docs/CRAFT_OFFERS.md`): built, off by default, awaiting real-server acceptance.
  Track D builds on it.
- **Real-client acceptance** still owed: member ledger sync, duels and announcements with several
  clients; the addon UI batch of 5 November needs an in-game re-check
  ([backlog](docs/archive/UI_FIX_BACKLOG_2026-11-05.md)); Forever live acceptance; dungeon G6-G8 and
  French client G10 ([6.2 game acceptance](docs/V6_2_GAME_ACCEPTANCE.md)).
- **Microsoft Store:** confirm which version has certified before claiming status.
- **Commands:** drop slash commands that only repeat a button (`/raid signup`,
  `/community lottery join`, `/craft claim`) once each button is confirmed in Discord.
- **Public page per guild** ([design](docs/GUILD_PAGES_DESIGN.md)): officers choose what is public.
- **Android app** (`mobile/`): the Expo/EAS project is linked (`ddda073f-f6bb-4e04-8a78-7ac343e03864`,
  account kevincaron28) and preview APK 0.2.0 is published (GitHub pre-release `mobile-v0.2.0-preview`,
  linked on /companion/), with OTA updates on channel `preview`. Still open: merge PR #345 (server
  parts for mobile alerts and token renewal); add an `EXPO_TOKEN` repo secret so merges publish OTA
  updates; add `--environment preview` to the `update:preview` script; push notifications need a
  Firebase project (`google-services.json`); then Google Play (12 testers for 14 days). On this PC
  run EAS as `npx.cmd eas-cli …` (PowerShell blocks plain `npx`).

## Later

- Raid leader tools live in the separate **Pullscript** addon (CurseForge 1729283).
- More standalone first-run improvements: [STANDALONE_ADDON_ROADMAP.md](docs/STANDALONE_ADDON_ROADMAP.md).
- Turning other WoW editions or PoE2 back on: [FOREVER_ONLY_FOCUS.md](docs/FOREVER_ONLY_FOCUS.md).
