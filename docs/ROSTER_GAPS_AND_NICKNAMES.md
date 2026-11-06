# Roster gaps, nicknames and the roster picture (8.5, track C)

**Owner decision (6 November 2026): everything here is on by default in every server**, with officer off switches and member opt-outs. Roster gaps and the roster card are just available; the DM button is an officer click, never automatic.

## `/officer roster gaps` (C1)
Three lists, private to the officer:
1. **In Discord, not in the guild**: members with a linked character but none seen in the guild roster within 14 days (`Character.guildRankAt`, refreshed by an officer's companion upload). Each has a `/ginvite First Last` line (Forever names have two parts); **Copy all /ginvite lines** replies with every line in one code block.
2. **No linked character**: **Ask them to link** asks for a confirmation, then sends the normal link prompt (`character-link-prompt.ts`) by DM to at most 25 members per click.
3. **In the guild, nobody claimed**: `UnclaimedCharacter` rows seen within 14 days.

Bots and members holding an ignored role are left out (`/officer roster ignore role:@Guests`). When no officer upload is recent the report says so: "not in the guild" cannot be trusted then. The same lists are on the roster dashboard (`/me/roster`, link "Discord only"), with a select-all text box for the invite lines.

## Nickname sync (C2), on by default
`/officer roster nicknames on:true [format:...] [apply:true]`. Default format `{name} ({full})` = `kevmister28 (Lebowski Holyroller)`: the Discord username or global name (never the current nickname, so re-syncs do not nest) plus the main's full Forever name. Over 32 characters it falls back to `Name(First Last)`, then `Name(First L.)`, then `Name(First)`, then a shortened Discord name with … keeping `(First)`; the Discord name is never dropped, and a member whose name still does not fit is skipped. `{main}` = first name only is available in a custom format. Runs hourly next to rank roles (`nickname-sync.ts`), previews unless `apply:true`.
- Skips the server owner, bots, anyone whose role is above the bot's, and members without a linked character.
- The nickname a member had is stored (`MemberNickname`). A member runs `/character nickname on:false` to opt out and gets it back; turning the sync off restores everyone. A nickname the member changed themselves is never overwritten on restore.
- If the bot lacks Manage Nicknames the sync quietly does nothing and `/setup` warns. `/setup` adds an optional "Nickname sync permission" check (Manage Nicknames) while the sync is on.
- Needs Manage Nicknames. It is deliberately not in `REQUIRED_BOT_PERMISSIONS`, so servers that never use the feature are not asked for it.

## Who's who board (C2)
Posts in the bot guide channel until an officer picks one: `/officer roster whoswho channel:#...` (`on:false` switches it off). One bot message (up to 3 embeds, ~5400 characters) edited in place, each member with main in bold then alts. Large guilds are cut at the limit and the footer says "N of M". Refreshed every 30 minutes with the other boards, via `discord-jobs.ts` (`WHOS_WHO_BOARD`).

## Roster picture (C3)
`src/services/roster-visual.ts`: class counts by level band (same query and bands as `/report guild`) and a profession grid (crafters, top skill, red when nobody has it). Drawn as a share card (`score-card.ts` roster layout) attached to `/report guild`, and as inline SVG charts on the roster dashboard.

## Not verified here
Nothing was run against a live Discord server. Needs a test server: renaming and restoring, Manage Nicknames check, the DM button, the board staying one message across a bot restart, and a hand check of the three lists on Québec Gold.

## C4: professions on the roster
The roster dashboard shows each character's professions with skill ("Mining 225"). `src/services/profession-note.ts` defines the public-note tag (`Alch300 Herb300`, highest skill first, at most 31 characters) and `noteIsWritable` (a note may only be overwritten when empty or already made only of such tags; officer notes are never touched). **Not built in this PR (addon, needs the Forever client):** the in-game roster window icons, the Blizzard roster tooltip, and the one-click "write professions to public notes" batch in `Modules/RosterTools.lua`. It must reuse the reviewed note action, show a preview first, and be tested in game, because Forever may not allow addon note edits.

## C5: promotion panel (on by default)
`/officer promotion list` shows **Ready to promote** (in Discord, a linked character at rank `Initiate` for 7+ days, optional minimum level), **Not in Discord yet** (linked members who left the server, plus unclaimed guild characters at that rank, from the officer's last upload) and who is not ready yet. `/officer promotion rule` changes the rank, days, level, the weekly list and its channel (default: the log channel); `on:false` switches the panel off. The weekly list posts at most once every 7 days and only when someone is ready. "Days at the rank" is measured from when the bot first saw that rank (`CharacterRankSeen`; a new record starts at the link date, a rank change starts over), so it is only as precise as the hourly checks. After the in-game promotion, rank roles update the Discord role on the next sync. **Not built here (addon):** the in-game "Ready to promote" panel with a Promote click; the bot's `loadPromotionPlan` result is the data it would take through the officer bridge.
