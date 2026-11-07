# WoW Forever only, and the PoE2 switches

## WoW: Forever only (7 November 2026)

Guilded supports **WoW Forever only**. The other WoW editions (Classic Era/Hardcore, TBC Anniversary, Mists
Classic, Retail) were first hidden behind a switch (5 November 2026), then removed from the addons, packaging,
companion, bot, website and docs in staged PRs (#567, #568, #571, #573, #577, #578, #580, #581); the plan and
inventory are in `docs/plans/FOREVER_ONLY_REMOVAL.md`.

What stays, on purpose:

- **Stored data.** No migration removed anything: every `gameEdition` column and value, other editions' guilds,
  characters, runs, seasons and earned achievements stay in the database and stay readable.
  `companion/game-edition.mjs` still parses the old edition ids for that reason.
- **Uploads from other WoW versions are refused** with one plain message (`assertForeverEdition`): addon snapshots,
  dungeon runs, personal companion uploads and character import. Old SavedVariables still load in the addon.
- **Old addresses keep working.** The website Worker redirects `/classic-era/`, `/tbc/`, `/mists/`, `/retail/` and
  `/editions/<other>/` permanently to the WoW Forever equivalent.
- **Published downloads.** Files already published for other editions on CurseForge and GitHub are untouched.
  Releases publish only the Forever `Guilded` and `GuildedDungeons` zips (`npm run addon:editions`).
- **Discord channels and roles** created for other editions are not deleted by any command (owner decision); remove
  them by hand in Discord if wanted (`src/setup-names.ts` lists them).

Whether to delete the other editions' stored rows is an open owner decision (stage 7 of the plan); the
recommendation is to leave them.

## PoE2: the remaining switches

Path of Exile 2 (PoE2) tracking is hidden, not deleted. `companion/active-games.mjs` decides it; tests prove every
surface follows it (`tests/forever-only-focus.test.ts`).

| Switch | Now | What it controls |
| --- | --- | --- |
| `ACTIVE_GAMES` | `["wow", "poe2"]` | Which games exist as a Discord community: PoE2 event boards, community seasons and lottery choices, the Quebec Gold PoE2 page. |
| `ACTIVE_TRACKING` | `[]` | PoE2 **tracking**: the companion's Client.txt log tracking and settings, `/poe`, the companion API routes `/api/v1/poe/*`, PoE2 achievements and the journal text. |

With tracking off, `/poe` is not registered with Discord, `/help` and the FAQ do not mention it, the companion hides
the PoE2 page, card and settings and never starts the log watcher, and the bot answers old companions with "paused"
(nothing is stored). The PoE2 Discord community (channels, roles, event board reminders, seasons, lottery PoE
currency) and the Quebec Gold PoE2 page stay.

## Achievements are Forever and guild only (catalogue version 7)

From 8.5.0 the achievement catalogue holds only `wow-forever-*` and guild rows. Rows for PoE2, Classic Era, TBC,
Mists, Retail and the old edition-less WoW rows are retired (`RETIRED_ACHIEVEMENT_IDS` in
`src/services/achievements-catalogue.ts`): members' earned rows stay in the database, but no surface shows, counts or
announces them. See "Bringing a retired row back" in `docs/ACHIEVEMENTS.md`.

## Turning PoE2 back on

1. **PoE2 tracking**: set `ACTIVE_TRACKING = ["poe2"]` (PoE2 achievements stay retired; restoring them is described
   in `docs/ACHIEVEMENTS.md`). The bot registers `/poe` on its next start; the companion needs a new release; members
   re-enable it in Settings (their saved choice was kept).
2. **PoE2 community off** (not requested): remove `"poe2"` from `ACTIVE_GAMES`.
