# World PvP review — 10 November 2026

Scope: everything in Guilded that touches open-world PvP, read from `origin/main` (8617eddc, 9.1.3). Addon: `CallForHelp.lua`,
`WorldPvP.lua`, `Duels.lua`, `Milestones.lua` (PvP steps), `GuildMap.lua` (call pins), `Battleground.lua` (for what it must not
count). Bot: `world-pvp.ts`, `duels.ts`, `duel-board.ts`, `bg-ladder.ts`, `guild-map.ts`, `pvp-group*.ts`, the companion upload path.
No game client was run: everything below comes from reading code and the Lua tests, so "likely" means "follows from the code".

## Summary

The design is sound: nothing is sent by itself, the combat log is not read, kills come from the game's own honorable-kill line,
and every number the board shows is capped on the bot. I found **two real bugs, fixed in this PR**, and **one data-flow gap the owner
should decide on** (zero-setup companions upload no PvP data at all). No taint or protected-function problem in the world PvP code.

Fixed here (with Lua tests):

1. **A declined duel request could switch Call for help off for the rest of the session.** `StartDuel` / `DUEL_REQUESTED` set
   `dueling = true`; only `DUEL_FINISHED` or a loading screen cleared it. A request that is declined, out of range or times out may
   never fire `DUEL_FINISHED`, and while `dueling` was true no attack was confirmed, so the "Call for help" button never appeared (and
   deaths were not counted). Now an unanswered request stops counting after 60 s; a duel that really started (countdown, in or out of
   bounds) lasts until `DUEL_FINISHED`.
2. **Duel wins were not tied to the player on WoW Forever.** `Duels.lua` compared the duel line's names with `UnitName("player")`,
   which on Forever is the first name only (the surname is a second return value; `Util.lua` `unitKey` documents this). When the
   system line carries "First Last", the player was never recognised as winner or loser, so the result was recorded locally but not
   shared with the guild's addons and the duel-win milestones (1, 10, 50, 100) never fired. Now the player is `ns.util.unitKey`
   (full name) and a name that is only a first name matches the full name; two different surnames stay two players. If the duel line
   in fact carries only first names, behaviour is unchanged.

## Findings by area

### 1. Bugs and edge cases

| Check | Result |
| --- | --- |
| False calls for help | Nothing is ever sent without a click. The button needs an enemy **player**, in combat, **targeting me** (seen through target, focus, mouseover, nameplates), and 2 hits within 10 s, outside instances, not in a duel. The 9.0.2 false call is covered by the tests. Remaining gap was bug 1 above (false negative, not false positive). |
| Kill credited twice by several guildmates | Cannot happen: a kill is the player's **own** honor line, never a peer message, and the same victim within 5 s is dropped. Two guildmates in one party each get their own honorable kill, as the game gives them; that is two kills by the game's rules. The bot caps 300 a week and 3 repeat victims (from the last 30 listed). |
| Battleground / arena kills | Not counted: `IsInInstance()` is true in battlegrounds, and `noteKill` returns early. Honorable-kill **milestones** (1/100/500/1000) use the lifetime stat and do include battlegrounds; that is intended (it is the game's HK count). |
| Duels counted as world PvP | No: duels give no honor line, and duel hits are ignored by Call for help (bug 1 aside). Duels have their own ladder (5 a pair a day, 25 a reporter a day). |
| Cross-realm / layers | Calls go on the **guild** addon channel, so the banner reaches guildmates on any layer or realm; "same zone" is decided from the caller's map id (or zone name). Two characters on different layers get a banner for a fight they cannot join or see. The addon cannot tell the layer, so this stays a known limit; the banner text could say "may be on another layer" (see recommendations). |
| Full first + last names | Calls, defends and replies go through `ns.normalizeName`/`unitKey` (full names). Bug 2 was the exception. The bot matches full names, with the first-name fallback of 8.5 (`foreverNameMatches`). Attackers are shown as `UnitName` of the enemy, so an enemy appears by **first name only** in banners and in the uploaded call (`attackers[].n`). Cosmetic. |
| "Calls answered" | Counted once per answerer per state; an answerer who flips Y → N → Y is counted twice. Capped on the bot by the guild's real calls. Minor. |
| Defends | A defend is any honorable kill within 5 minutes of pressing "On my way", anywhere (not limited to the caller's zone). The bot caps defends to calls answered and to kills. Generous but capped; see recommendation 9. |
| Week rollover | `store()` replaces the week table at the first event after Tuesday 15:00 UTC. SavedVariables are written only at logout or `/reload`, so a session that spans the reset **loses the old week's kills** (never reaches the file). The bot accepts the previous week for late uploads, but the addon has nothing to send. Low impact (reset is 10:00 Quebec time), see recommendation 2. |
| Duel timing | Addon dedupes the same pair within 60 s, the bot within 120 s: an immediate rematch inside two minutes with the same winner is counted once by the bot. Rare; fine. The score uses the characters' levels **at import time**, not at the duel. Rare; fine. |

### 2. Taint and protected-function risks

Checked every path that can run in combat (`UNIT_COMBAT`, `CHAT_MSG_ADDON`, `PLAYER_DEAD`, honor line):

- **No protected call anywhere.** Invite buttons are plain buttons showing a copy box since 9.1.3 (#714); no `SetAttribute` after login,
  no `InviteUnit`/`GuildInvite`, no guild-note edits, no `ToggleWorldMap`. The "Join" button whispers `inv` with `SendChatMessage`
  on a click (allowed).
- Frames (`makeFrame`, buttons) are created lazily in combat; they are non-secure templates, which is allowed. The leftover
  `afterCombat` deferral around the mate rows (`refreshMates`) is now unnecessary but harmless.
- `RaidNotice_AddMessage` is called from addon code when a call arrives. It is Blizzard's own helper and is wrapped in `pcall`;
  if a blocked-action popup ever names `RaidWarningFrame`, this is the first suspect (the line in chat and the banner already carry
  the alert, so it could simply be dropped).
- Map dots (a received call pins the caller): own overlay on `UIParent`, never opens or hooks the world map (#662). Safe in combat.
- **One low-risk spot:** the guild-map pin tooltip (`GuildMap.lua` pin `OnEnter`) fills `GameTooltip` even in combat. It only runs on
  hover over our own dot and does not decorate a Blizzard tooltip, so it is unlikely to taint, but "no tooltip work in combat" is the
  rule learned this week; a one-line `if inCombat then return end` would settle it.

### 3. Data flow

| Piece | Where it lives | How it reaches Discord | Delay |
| --- | --- | --- | --- |
| Call for help | addon channel `GuildedSOS` to every guildmate; optional one line in guild chat; own calls saved in `db.helpCalls` | companion uploads `helpCalls` (with `mapShare` coordinates only while the member shares); stored as `GuildHelpCall`; the bot **has a hook `onHelpCallStored` that nothing uses**, so Discord shows no live call | in game: seconds. Discord: none |
| Kills / defends / answered | `db.worldPvp` (week, total, last 30 kills) | companion exports week kills, defends, responded and the 30 recent victims; bot caps and stores `WorldPvpWeek` | file is written at logout or `/reload` → companion upload → board message **edited only by the 30-minute timer** (an upload marks the standings feed, not the Discord board) |
| Deaths | local only (`/guilded worldpvp`) | not uploaded, not shown (owner default, 7 Nov) | n/a |
| Duels | `db.duels.results`, shared as `GuildedDuel` between guildmates | companion uploads, reporter must be winner or loser, pair-day caps | same as kills |
| PvP group finder | Discord only (`/battleground` panel → modal → `dgrp:` post in the finder channel) | none from the addon | immediate |

Stays local and should: deaths, the 30-victim list beyond what the bot needs, the `total` counters. Uploaded and worth knowing: enemy
players' first names, class and level inside `attackers` on every call, and the caller's coordinates (opt-out switch `mapShareOff`
strips them).

**Gap that needs an owner decision.** The zero-setup companion (9.1.0, unsigned device key) uploads characters and dungeon runs only
(`handleDeviceUpload`). Kills, defends, duels, milestones and calls for help are applied **only for a paired (signed-in) member**
(`companion-api.ts` `pairedMemberId`). A member who installed the companion and never signed in with Discord shows up on no PvP
board, and their calls are missing from the guild's call count, which lowers everyone's "helped/defends" cap. `guildMapEnabled`
off also stops calls being stored, which silently zeroes defends and helped for the whole guild.

### 4. French

Every `L("…")` string in `CallForHelp.lua`, `WorldPvP.lua`, `Duels.lua`, `Milestones.lua` and `GuildMap.lua` has a French entry in
`Locale.lua` (checked mechanically, compass words included). One English-only line remains and is visible to the French
guild: the guild-chat call `[Guilded] Help! X is under attack in …` (`CallForHelp.lua` `guildChatLine`). Nothing parses the English chat line on the bot side (searched `src/`),
so it can be localised safely (recommendation 4).

## Ranked recommendations (behaviour changes: owner to choose; none built)

| # | Idea | Value | Effort |
| --- | --- | --- | --- |
| 1 | **Tell unsigned members what they miss, or let devices upload PvP data.** Minimum: a Start-page and in-game line "Sign in with Discord to count your PvP on the boards". Fuller: accept `duelResults` / `worldPvp` from a claimed-by-reported-character device (needs a trust rule). | High: the main reason a member can be missing from the boards | Hint: low. Device upload: medium |
| 2 | **Keep last week on rollover** (`worldPvp.prev`, exported as a second block; bot applies every valid block, not only the first). | Medium: stops losing the last hours before the Tuesday reset | Low–medium |
| 3 | **Discord ping or post for calls for help** using the existing `onHelpCallStored` hook: opt-in per server, to the PvP channel, "X called for help in Duskwood" with a link to the phone map, edited to "cleared" on all clear. | High for a PvP guild; needs the owner's opt-in rule (rule 5) | Medium |
| 4 | **Localise the guild-chat call line** (and "All clear") in French, using the caller's language. | Medium for Québec Gold | Low |
| 5 | **Refresh the world PvP and duel boards shortly after an upload** (debounced, e.g. 2 minutes) instead of only every 30 minutes. | Medium: makes "I just won" visible | Low |
| 6 | **Defender of the week line** and a Tuesday recap post (top killer, top defender, most calls answered, fastest answer). Already planned in `docs/WORLD_PVP.md` stage 3. | High for fun | Medium |
| 7 | **Hot zones**: a "where were we ganked this week" list or map layer from `GuildHelpCall` (zone counts, attackers' classes), shown in the phone map and `/pvp`. | Medium | Medium |
| 8 | **Most wanted**: attackers seen more than twice across guild calls this week, shown on the board and in the call banner ("repeat offender"). Needs the member-visible attacker names to stay as stored. | Medium | Medium |
| 9 | **Tighter defends**: count a defend only when the kill happens in the caller's zone (the call carries the zone). Makes the number mean more; lowers it for everyone. | Low–medium | Low |
| 10 | **Layer warning** on the banner ("you may be on another layer") is impossible to detect; the alternative is an "I can't see them" button that tells the caller. | Low | Low |
| 11 | Combat guard on the guild-map pin tooltip (section 2). | Low (safety) | Trivial |
| 12 | Make `guildMapEnabled` off not zero the defends cap: store calls without coordinates when the map is off. | Low | Low |

## Verification

`npx vitest run tests/lua/call-for-help.test.ts tests/lua/milestones-duels.test.ts tests/lua/world-pvp.test.ts` (new tests: an
unaccepted duel request expires, a started duel does not, my own duels by full name, two surnames kept apart). No version bump.
No real client was available: the two fixes should be confirmed in game (decline a duel, then get attacked; win a duel against a
guildmate and check `/guilded duels me`).
