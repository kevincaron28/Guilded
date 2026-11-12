# Guild message of the day, one click

> **Removed in 9.2.** The MOTD reminder module (`GuildMotd.lua`), its tab and `/guilded motd` are gone; `/guilded motd` prints a one-line
> "removed" message. This page is kept as the record of why (WoW does not let addons set the message of the day).

Guilded is a **reminder plus a copy box** for the in-game guild MOTD (`addon/Guilded/Modules/GuildMotd.lua`). WoW does not let
addons set the message of the day: `GuildSetMOTD` is Blizzard-UI only on Forever, and chat-box text an addon fills in is
tainted, so `/gmotd` pre-filled by an addon is blocked too. When a rotation or next-raid update is due, the elected officer
sees a small "Update guild message: <preview>" button at the top of the screen (and one chat line). Clicking it (or the tab's
**Update now**) opens a window with the ready text highlighted: Ctrl+C, then Guild (J) > Info, click the message of the day,
paste and Accept. Guilded counts it as written only when the roster's MOTD reads back equal to that text. Off by default.
The validator and a test fail the build if the module touches the chat box or any MOTD function.

## Turning it on

Guilded window > **Guild message** tab (officers; Settings has a button), or `/guilded motd config`.
Chat commands: `/guilded motd [on|off | mode rotate|event | hours N | add <line> | clear | suffix <text> | resume | config]`.

- **Rotation**: officer-written lines (up to 12, 128 characters each), one every N hours (default 24).
- **Next raid**: built from the raids the bot published (`GuildedRaids`, via the companion), for example
  `Prochain raid : Hyjal mercredi 20h00 - inscris-toi sur Discord !` (French or English by the client language,
  in the computer's time zone). Falls back to the rotation lines when no raid is known.
- **Suffix**: optional text added to every message, for example `Lie ton perso: Guilded Companion`.
  Messages never exceed 128 bytes; the suffix is kept and the line is shortened (never mid-character).

## Safety rules

- Only an officer client with the addon, `CanEditMOTD()` true and the switch on is offered the update. The API is `GuildSetMOTD`
  (or `C_GuildInfo.SetMOTD`). A client without it stays quiet and Settings says so.
- One writer: officers with the feature on say hello on the `GuildedMotd` prefix; the lowest-named online officer who
  can edit the MOTD is shown the button (alone, that is you; the first 10 seconds are spent listening for others). Hellos expire after 150 s, so another officer takes over when the writer goes offline.
- Manual edit: if the MOTD differs from the last text Guilded confirmed (never before the first confirmed write),
  the automation pauses for every officer until someone presses **Resume**.
- Rotation position and timing are shared with the other officers' addons (`W|index|time|text`), so a new writer
  continues instead of restarting. Messages from non-officers are ignored.
- Settings live per guild in `GuildedDB.motd` on each officer's PC (lines are not synced between officers yet).

## Follow-up (not in this change): Discord-side rotation lines

Officers could set the rotation lines in Discord (for example `/guilded-motd lines`) and the bot would write them next
to the standings the way `GuildedRaids` is written, so every officer's addon shares one list. This needs a Prisma
field, a command (watch the merged `/setup` + `/config` 4000-character limit, put it in its own command), French
strings, companion export and an addon reader. Not started.

## In-game verification still owed

Forever, Era/TBC and Mists: `CanEditMOTD`/`GuildSetMOTD` behave as expected for an officer with MOTD rights and are
refused or reported for a rank without; the roster's MOTD text matches what was written so the manual-edit check does not
pause on its own write; two officers online elect one writer.
