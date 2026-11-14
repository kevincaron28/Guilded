# Milestone announcements and guild duels (8.4.5 candidate)

Two features that share the addon's events. Neither posts anything on its own.

## Milestone announcements (addon `Modules/Milestones.lua`)

One short line in GUILD chat when a character reaches a personal milestone, so guildmates can cheer ("Crashing reached level 10!").

- Milestones: level 10, 20 ... and the edition's maximum level; the first completed run of each dungeon (the character must be in the run); lifetime honorable kills 1 / 100 / 500 / 1000 (`GetPVPLifetimeStats`, nil-safe); duel wins 1 / 10 / 50 / 100.
- **ON by default for every character** (explicit owner decision, 5 Nov 2026). Before the first line is ever sent, a one-time local notice (chat frame only, not sent) says so and how to stop. `/guilded announce off` (or `on`), `/guilded announce level|dungeon|hk|duel on|off`, or Esc > Options > AddOns > Guilded; the choice persists per character.
- **Officers can switch it off for the whole guild** with `/guilded announce guild off` (and `on` again). The off state wins over member choices and is repeated when an officer logs in so offline members get it too.
- Once per milestone per character, ever (SavedVariables `GuildedDB.milestones.chars[...]`). What a character already had when the module first ran, and anything reached while announcements are off, is recorded silently, so turning it on never replays history. A jump (a level boost) announces only the highest new step.
- At most one line per 30 seconds, GUILD channel only, never in combat; a refused send is retried a few times, then dropped.
- English/French text from `Locale.lua` (German and Spanish too), by the player's language (client locale unless `/guilded lang` is set).

### To the bot

The companion uploads each character's recorded milestones (`milestones`: kind, ref, value, time; own characters only) and, from the same file, duels. On the bot, `MemberMilestone` feeds the existing achievements (new ladders: honorable kills, duel wins; plus dungeon-variety 1 and 10, "Unbeaten" for 5 duel wins in a row and "Giant Slayer" for beating the guild's #1 duelist; catalogue version 6, which baselines quietly once, so a backfill never posts). Level steps (every 10 plus the cap, per edition) and dungeon variety are computed server-side from synced characters and runs, so members who never announce still earn them. **The Discord echo is the existing per-server opt-in** (`/config achievements`, `achievementAnnounceEnabled`, off by default): the new rows are announced only where an officer already turned celebrations on.

## Guild duels (addon `Modules/Duels.lua`, bot `src/services/duels.ts`)

- The addon reads the client's `DUEL_WINNER_KNOCKOUT` / `DUEL_WINNER_RETREAT` strings (argument order taken from the `%1$s` / `%2$s` markers, so every language works) and records a duel only when both players are in the guild.
- A participant shares the result on the addon channel (`GuildedDuel`); the same pair within 60 seconds is the same duel, whoever reports it. A shared result is believed only from the winner or the loser.
- In-game: `/guilded duels [me]`, and a **Duels** page in the tools window ("Fun and runs").
- Bot: duels arrive with the paired companion upload. The uploader must be the winner or the loser; both players' uploads of the same duel (within 120 s) are one row.
- Discord: `/bg duels`. Website: `/leaderboards/guild/<id>/duels` (guilds that publish their runs). Forever-first: the guild's own edition.

## Not verified in game

The duel system lines (argument order of the retreat line), `GetPVPLifetimeStats` per edition, the prompt frame and the Duels page layout, and a real two-client duel are covered by the offline Lua harness only.
