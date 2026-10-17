# Guilded 6.3.2 — Polish from a full in-game pass

Patch release, October 17, 2026. Addon, bot and Windows companion move together to 6.3.2;
protocol remains 2. Everything below was found or checked in game on WoW Forever, on one PC and,
where two players were needed, on two PCs ([checklist](V6_2_GAME_ACCEPTANCE.md)).

## Addon

### Fixed

- **Gear check right after login.** WoW Forever reports no gear for a few seconds after login,
  and the automatic check recorded and shared "Not ready, 10 empty slots" with the guild.
  Automatic checks now wait for the gear to load. Manual checks and officers' requests still
  answer at once.
- **Guilded chat tab.** `/guilded chat off` now closes the Guilded tab instead of leaving it
  open and empty. Turning it back on opens a tab you can see again; before, the lines went into
  the hidden window.
- **SR+ for members.** The reserve keeper now shares each reserve's SR+ bonus, so members see
  "(SR+10)" on their own list too, including on their own "Yours:" line. Older clients simply
  show no bonus.
- **Windows close normally.** Escape now closes the dungeon finder, the calendar and the guild
  window when Guilded opened them; before, it opened the Game Menu and left them open. The
  dungeon page's **Close** button closes the finder. Inside the guild and calendar windows there
  is now one close button instead of two.
- **Calendar page.** The text wraps instead of being cut off mid-word, and "Last scan" shows
  "today 06:35" instead of a raw timestamp.

### Easier to use

- **`/guilded` on its own opens the window.** `/guilded help` still lists every command.
- **Local guild page, step by step.** New in-game-only guilds get three numbered steps
  (1. Create a raid core, 2. Choose how loot is given, 3. Add your raiders) and a "Share and keep
  safe" section. Each has a one-line explanation, and the buttons have hover help, including
  what each loot system does. Every button now says what happened and what to do next, the loot
  buttons show the selected core's own rules, and a status line says what is set up.
- **Home** shows your real guild rank ("Guild Master") and a clearer loot-system line.
- **Dungeon season view:** "(30)" instead of "(30-30)", and the season score is shown once.
- French: the new and changed text is translated, and one missing accent was fixed.

### Less guild chatter

- The automatic gear check used to send your full gear status to the whole guild on every bag
  change (every loot) and every skill-up, even when nothing changed. It now sends only when
  something changed, plus a check-in every 10 minutes. Ready checks from officers and raid
  leaders are still always answered.

## Checked in game (17 October)

- **Two PCs:** chat tab on/off on both, SR+ on a member's reserve list, and a fresh
  member profile receiving officer standings (the rest of G1): **all PASS**.
- **Main PC:** every page of the window, the dungeon and season views, Guild & Communities,
  the calendar, and Escape and Close on each window, after each fix.
- Not run in game: creating a core from the new Local guild page (the test PC uses the Discord
  connection, where local cores are read-only; covered by automated tests). Still owed from the
  checklist: G6–G8 (dungeon runs), G10 (French client), G9 with Guilded Games installed, the
  6.1.2 parts of G2 and G12, and the desktop companion checks.

## Bot and companion

No changes besides the version number.

## Database

No new migrations.
