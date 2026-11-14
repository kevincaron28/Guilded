# Run sharing between parties from different guilds (14 November 2026)

Owner request: when a dungeon party mixes guilds, every guild with a member in the run gets that run on its own board (its member's score, its own Discord run card showing the other players' guild names), and the public boards show the run once.

## What exists

- **Guild lane.** `importDungeonRuns` (`src/services/dungeon-import.ts`) is the one place a guild stores a run, whether it came from a signed companion upload, the officer import or the zero-setup device path. Points go only to the guild's own linked characters. One run per guild and run id. Each guild has its own season and rules.
- **Public lane.** `ingestPublicRuns` keeps one row per run, so the public boards already show a run once however many guilds or uploaders send it. A guild can stop publishing (`publicDungeonRuns`).
- **Relay.** A run reaches a companion through the GUILD channel or, since 9.3.1 (#880), through the party or raid. Group-carried runs never enter a guild lane; they go to the public lane (`relay-public.ts`).
- **Per-player guild text** (9.3.0): each player of a run carries the guild name their addon saw. It is presentation only and the run card already prints it.
- **Parked guilds** (#856): runs made for another guild wait for that guild's server.
- **One witness** (#872): one player's addon is enough for a run to count.

## What is missing

A run is stored in the guild lane of the guild the uploader belongs to, and on the public boards. A guild whose member was in the party, but whose members did not upload (or whose member's addon never reached a companion of that guild), never gets the run on its own board or in its own channel. The member's run is only fully known to the guild(s) of the uploader.

## Smallest design: fan out a stored run to the other guilds

Once a lane has stored or placed a run, the bot stores the same run again, through the same import pipeline, in every **other** registered guild that has a member in it. Nothing new is stored on the public boards (they already key one row per run).

1. **Which guilds.** A guild counts only when its own roster (a linked or reported character of one of its members, same game edition, member not gone) matches a player of the run. What the run says about guilds is never used to choose a guild. Guilds that switched sharing off, and the guild the run came from, are left out.
2. **How it is stored.** Through `importSharedRun`, which calls the existing import with that guild's own character list. So: that guild's season and rules, points only for its own members, its own duplicate handling (same run id or the same party and start time), its own receipts. Other guilds' characters show on the run as names, classes and levels with the guild text the run recorded.
3. **When.** After the work that stored the run has been saved and the upload answered, in the background. A failure in one guild never affects the upload or the other guilds. Entry points: the signed upload and the officer import (the guild lane's stored runs), the device upload (stored runs and group-relayed runs), and the signed group relay.
4. **Cards.** Each guild that stored the run posts its own card and refreshes its board through the existing announce path. A guild with no dungeon channel simply posts nothing.
5. **Nobody resends for ever.** The uploader's receipt is unchanged: it is given by the lane that received the run. The fan-out stores a receipt in each other guild too, so a member of that guild uploading the same run later sees it as already held.
6. **Switch and thresholds.** Officers can turn the sharing off for their guild with `/dungeon records other-guilds:false` (on by default). The number of guilds a run is shared with and the number of first-hand reports needed are server configuration (`RUN_INTEGRITY_CONFIG`), not wording in any member-facing text.

### Cases

| Case | Result |
|---|---|
| Guild does not publish publicly | Unchanged: the public lane keeps its own rule. The guild still gets its members' runs in its own lane. |
| Guild has parked or is not set up | It has no registered roster, so it is not found; nothing is stored. When it is set up, its own members' later runs flow normally. |
| A player in no guild | No guild to give the run to; the run stays on the public boards as before. |
| Seasons and rules differ per guild | Each guild applies its own, since the run goes through that guild's own import. |
| Run already known to the other guild | The existing duplicate handling keeps one run; no double points. |
| Privacy | Only character names, classes, levels and guild names cross from one guild to another. No Discord ids, member ids or links leave the guild that owns them. |
| Abuse: a stranger puts a run on a guild's board for someone who was not there | A guild is found only through its own roster. The run must already have been accepted by its first lane, which needs a player in the run to have reported it. A guild's member with no part in the run is never given points, because points go only to characters that are players of the run. |

## Bot-only (this change)

- Migration `20270219000000_cross_guild_runs` (`GuildSettings.crossGuildRuns`).
- `src/services/cross-guild-runs.ts` (find guilds, store), `src/services/cross-guild-post.ts` (store and announce), `importSharedRun` and the `shareable` list in `dungeon-import.ts`.
- Hooks: `followUpImport` (signed and officer imports), the device upload (`afterShare`), the relay lane (`onPlaced`).
- Officer switch on `/dungeon records`. Server configuration keys `crossGuildMaxGuilds`, `crossGuildMinReporters`.

## Needs an addon or companion release

- **Member-side upload from another guild.** A member whose companion is linked to guild A but whose saved file holds a run played with guild B members: today the companion uploads it to A only. The bot now covers this, but the companion could also tell the bot the party's guild names so the sharing can use them as a hint (the roster stays the evidence).
- **Per-player guild text accuracy.** The addon records each player's guild when it can read it (inspect or the group frame). Reading it more reliably in a party improves the card text only.
- **Addon-only players in a mixed party** already reach the public lane through #880; they reach a guild board through the fan-out once the addon with the group relay ships.

## Owner decisions (14 November 2026)

1. Sharing is on by default for every server, with an officer switch (`/dungeon records other-guilds:false`; English and French help text).
2. One player's report is enough to give another guild its copy (`crossGuildMinReporters` stays at 1 in the server configuration).
3. The other guild's dungeon channel gets the run card too, for device-path runs as well. The card goes through the same announce path as that guild's own runs: its own dungeon channel, its record callout switch and its queued delivery pace.
