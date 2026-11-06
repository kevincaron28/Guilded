# Roster gaps, nicknames and the roster picture (8.5, track C)

Everything here is **off or read-only until an officer uses it**. Nothing posts or renames on its own by default.

## `/officer roster gaps` (C1)
Three lists, private to the officer:
1. **In Discord, not in the guild**: members with a linked character but none seen in the guild roster within 14 days (`Character.guildRankAt`, refreshed by an officer's companion upload). Each has a `/ginvite First Last` line (Forever names have two parts); **Copy all /ginvite lines** replies with every line in one code block.
2. **No linked character**: **Ask them to link** asks for a confirmation, then sends the normal link prompt (`character-link-prompt.ts`) by DM to at most 25 members per click.
3. **In the guild, nobody claimed**: `UnclaimedCharacter` rows seen within 14 days.

Bots and members holding an ignored role are left out (`/officer roster ignore role:@Guests`). When no officer upload is recent the report says so: "not in the guild" cannot be trusted then. The same lists are on the roster dashboard (`/me/roster`, link "Discord only"), with a select-all text box for the invite lines.

## Nickname sync (C2), off by default
`/officer roster nicknames on:true [format:...] [apply:true]`. Default format `{name} ({full})` = `kevmister28 (Lebowski Holyroller)`: the Discord username or global name (never the current nickname, so re-syncs do not nest) plus the main's full Forever name. Over 32 characters it falls back to `Name(First Last)`, then a shortened name with …, then `(First Last)` alone; a name that still does not fit is skipped. `{main}` = first name only is available in a custom format. Runs hourly next to rank roles (`nickname-sync.ts`), previews unless `apply:true`.
- Skips the server owner, bots, anyone whose role is above the bot's, and members without a linked character.
- The nickname a member had is stored (`MemberNickname`). A member runs `/character nickname on:false` to opt out and gets it back; turning the sync off restores everyone. A nickname the member changed themselves is never overwritten on restore.
- `/setup` adds an optional "Nickname sync permission" check (Manage Nicknames) once the sync is on.
- Needs Manage Nicknames. It is deliberately not in `REQUIRED_BOT_PERMISSIONS`, so servers that never use the feature are not asked for it.

## Who's who board (C2)
`/officer roster whoswho on:true channel:#...`: one bot message (up to 3 embeds, ~5400 characters) edited in place, each member with main in bold then alts. Large guilds are cut at the limit and the footer says "N of M". Refreshed every 30 minutes with the other boards, via `discord-jobs.ts` (`WHOS_WHO_BOARD`).

## Roster picture (C3)
`src/services/roster-visual.ts`: class counts by level band (same query and bands as `/report guild`) and a profession grid (crafters, top skill, red when nobody has it). Drawn as a share card (`score-card.ts` roster layout) attached to `/report guild`, and as inline SVG charts on the roster dashboard.

## Not verified here
Nothing was run against a live Discord server. Needs a test server: renaming and restoring, Manage Nicknames check, the DM button, the board staying one message across a bot restart, and a hand check of the three lists on Québec Gold.
