# Guilded roadmap

## Current stage — 6 November 2026

Guilded **8.4.6** is published; the next release is 8.5.0 (planned below).
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
5. Everything that posts in Discord on its own is **off by default** with a `/config` or `/officer`
   switch (CLAUDE.md rule), except where this file records an owner decision saying otherwise.
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
- **Owner decision (6 November 2026):** default format `Discord name (Main First)`, main only, no alts.

**C3. Visual guild roster (classes and professions).**
- Existing: `/guild-health` text (`buildComposition`, level bands, retention); roster dashboard
  filters and `professionCoverage`; `score-card.ts` roster layout.
- Build: a roster card (image) with class counts by level band (class colours) and a profession grid
  (how many crafters per profession, max skill, gaps), shown by `/guild-health` and as charts on the
  roster dashboard web page. Optional permanent board in an officer channel.
- Done when: card renders for 0, 1 and 150 members without overlap; numbers equal `/guild-health`.

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

**F4. Fresh computer test.** Run the member path end to end on a clean Windows profile (Windows
Sandbox on the owner's Windows 10 Pro for the companion and folder steps; a real second PC for the
Store and WoW steps). Time each step, screenshot each screen, fix what confuses, and rewrite
`docs/MEMBER_INSTALL.md` (the French paragraph still lists all five editions). Record results in
`docs/FRESH_INSTALL_MEMBER_TEST.md`.
- Done when: a non-technical member can go from the Discord prompt to "Everything is linked" in under
  10 minutes with no question to an officer.

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

---

## Carried over (still open from 8.4)

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
- **Android app** (`mobile/`): waits for the owner's Expo account for the first APK.

## Later

- Raid leader tools live in the separate **Pullscript** addon (CurseForge 1729283).
- More standalone first-run improvements: [STANDALONE_ADDON_ROADMAP.md](docs/STANDALONE_ADDON_ROADMAP.md).
- Turning other WoW editions or PoE2 back on: [FOREVER_ONLY_FOCUS.md](docs/FOREVER_ONLY_FOCUS.md).
