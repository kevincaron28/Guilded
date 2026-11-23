# Direct guild invite from the Invite button (9.5.1 candidate, refused on WoW Forever)

Status: REFUSED on WoW Forever (owner test, 23 Nov 2026). From 9.5.2 the guild Invite button never calls the API on Forever: the copy box comes first, no popup. Party invites stay direct. WoW is never launched by an agent session.

## Result of the owner test (23 Nov 2026, 9.5.1)
Clicking **Invite** for "Suce Mafleche" showed "Guilded has been blocked from an action only available to the Blizzard UI", then the copy box opened with `/ginvite Suce Mafleche` (the fallback worked). So `C_GuildInfo.Invite` is refused on WoW Forever even straight from the hardware click of a plain Button, with the bare name, out of combat. Same answer as 9 Nov (#681). The saved file (written 23 Nov 04:44) predates this test, so no file:line frames from #1263 are recorded for it yet; they appear after the next /reload.

## What 9.5.2 does
`util.guildInvite` returns false at once when `util.isForever()` (interface 16001) unless `GuildedDB.inviteDirect.guildTry == true` (set by hand to re-test a future client build). Nothing is called, nothing is remembered as refused, no popup. Other clients keep the 9.5.1 behaviour below. Test: `tests/lua/invite-queue.test.ts`.

## The 9.5.1 candidate (kept for non-Forever clients)

## What was known
- 9 Nov 2026 (#681): `GuildInvite` called from the click of a plain button was refused on WoW Forever ("Guilded tried to call UNKNOWN()", ADDON_ACTION_FORBIDDEN).
- A secure macro button running `/ginvite` was refused ("taint from (null) - Invite()"); a line Guilded put in the chat box was refused ("taint from Guilded"). A line the player pastes works (the copy box).
- A PARTY invite (`C_PartyInfo.InviteUnit`) works, even from events (AutoLayer, ForeverLayers; Guilded since 9.4).

## What other addons do (web research, 22 Nov 2026)
- `C_GuildInfo.Invite` is listed as a protected function needing a hardware event on Retail (warcraft.wiki.gg protected functions). Fast Guild Invite - Revived calls it directly from a row click handler, never from a timer or event, and strips "-Realm" from same-realm names (its changelog says Retail rejects "Name-MyRealm").
- No source found for Guild Roster Manager's exact call; Greenwall-style addons were not checked.
- Not known: whether WoW Forever (Classic-era engine, interface 16001) treats the call the same way. The 9 Nov refusal says no, but that build and that button may differ (name format, template, deferred call). So this is a candidate.

## What 9.5.1 does
`ns.util.guildInvite(name)` (Util.lua) runs inside the Invite button's own OnClick, no timer, no secure template: `C_GuildInfo.Invite` (or `GuildInvite`) with the bare "First Last" name, out of combat, only when `CanGuildInvite()` is true, inside `ns.guardedCall` so a refusal names the call. A refusal (ADDON_ACTION_BLOCKED or FORBIDDEN naming Guilded within 2 s) is saved as `GuildedDB.inviteDirect.refusedGuild = <build>` (separate from the party memory), the same click shows the copy box, and later clicks skip the API on that build. The player's existing off switch (`inviteDirect.off`) also turns it off. The guard test now allows the guild invite API only in Util.lua.

## Owner check (needs 9.5.1 on the officer PC, one officer rank that can invite)
1. `/guilded invites`, pick a name that is NOT in the guild (a test character), click **Invite**.
2. Works: the chat says "Invited <name>." and the game's own answer follows (invited, or "already in a guild"); no copy box; no "Guilded has been blocked" popup. Reply "guild invite works".
3. Refused: one blocked popup may appear once, then the copy box shows `/ginvite First Last` as before. the in-game problem list lists `ADDON_ACTION_* ... (raised while calling C_GuildInfo.Invite (Invite button))`. Click Invite on a second name: no new popup (the refusal is remembered). Reply "guild invite refused" with that line.
