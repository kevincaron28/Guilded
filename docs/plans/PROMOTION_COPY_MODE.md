# Ready to promote: copy the game's own command (9.5.2)

Owner request, 23 Nov 2026: finish the promotions, research other addons, implement the best way that works.

## What the code did before
- `Promotion.lua` offered one reviewed click per member through `RosterTools` (`SetGuildMemberRank(index, rankNumber)` with the per-build rank-number self-check from #1134, or `GuildPromote` for a one-step move).
- A refusal (ADDON_ACTION_BLOCKED or FORBIDDEN naming Guilded within 2 s of the call) was remembered per client build (`rosterBlocked.rank` / `.promote`), after which the panel only copied the member's name and said "right-click the name in the guild roster".
- Saved diagnostics and `Logs\taint.log` on the owner PC (checked 23 Nov, SavedVariables written 04:44) hold **no promotion refusal**: the direct call was never recorded as tried, and nobody had clicked Promote on WoW Forever since the refusal memory was added.

## Evidence on WoW Forever
- Guild invite: refused from events, secure macro buttons, chat-box lines and, owner test 23 Nov 2026, the hardware click of a plain Button (docs/plans/GUILD_INVITE_DIRECT_TEST.md).
- Guild notes and automatic guild chat: refused (9.0.5, 9.3.8).
- The rank functions (`GuildPromote`, `GuildDemote`, `SetGuildMemberRank`, `C_GuildInfo.SetGuildRankOrder`) are protected: the warcraft.wiki.gg page for `C_GuildInfo.Promote` marks it "can only be called from secure code" and lists the Classic-era clients. There is no reason to expect a plain click to work where the invite did not.

## What other addons do (web research, 23 Nov 2026)
- Swyn's Guild Promoter (WoWInterface thread t-54798): stopped working when Blizzard protected `GuildPromote` / `SetGuildMemberRank`; a forum reply concluded "Blizzard wants you to do it their way". Nothing since works from addon code.
- Guild Roster Manager (GRM): its changelog says the Classic-only taint problem led it to restrict the ctrl-click action to just showing the guild roster and its own window; rank changes are left to Blizzard's roster menu. It never assigns ranks itself on Classic.
- GuildKit and Greenwall-style tools report on ranks and permissions and leave the change to the Blizzard guild frame.
- Common pattern: the addon decides who and shows it; the player makes the change through Blizzard's UI or the game's typed slash commands (`/gpromote Name`, `/gdemote Name`), which the game runs as secure input. That is exactly what the copy box already does for `/ginvite`.

## What 9.5.2 does
- On WoW Forever (`util.isForever()`) the panel never calls a rank function. `module.directAllowed()` is false; `GuildedDB.promoteTry = true` (set by hand) re-enables the direct path to test a future client build. Other clients keep the one-click path and its per-build refusal memory.
- One row per member, **Copy command** (opens the copy box with `/gpromote First Last`, Ctrl+C, paste in chat, Enter) and **Done** (hides the row if the officer promoted another way).
- **Copy next command (N left)** and the "Promote next" key binding copy the next member's command and call nothing.
- The bot's rule is still the only source of who is ready (feed, level, rank name); the alert count excludes members already copied; the X on the alert stays.
- Marks survive reload: `GuildedDB.promoCopied[key] = { from, to, at, done }`. A row shows "copied, waiting" until the roster shows the new rank, then the mark clears. Marks older than 3 days are dropped.
- An alt rank directly above the member (Alt between Member and Initiate): `/gpromote` moves one rank, so the row says "2 steps". After the first paste the member sits in the Alt rank; a "continue" row for that member (first in the list) offers the second `/gpromote` until they reach the target rank.
- Alts and main changes: **Copy command** copies `/gdemote Name` (once per rank down to the Alt rank, the step count is shown) or, for a swap's give-rank step, `/gpromote Name`.
- No popup: nothing protected is called, so there is no blocked-action warning to remember.

## Owner check (9.5.2 on the officer PC, one Initiate the bot lists as ready)
1. Log in as an officer who can promote. The "N ready to promote" alert appears (X closes it). Click it.
2. The rows show **Copy command** and **Done**; the top button says "Copy next command". No blocked popup appears.
3. Click **Copy command** for one member. The copy box shows `/gpromote First Last`. Ctrl+C, close the box, open chat, Ctrl+V, Enter. The member is promoted one rank (guild chat or the roster shows it).
4. Back in the panel (it refreshes on the roster event, or `/reload`): the row is gone, or shows "copied, waiting" until the roster updates. After `/reload` the "copied, waiting" mark is still there.
5. If your guild keeps an Alt rank between Member and Initiate: the row says "2 steps"; paste once, the member lands in Alt, a "continue" row appears; paste again.
6. Reply with what you saw (promoted / refused with the game's own message). `/guilded diag` lists any refusal with the Guilded file:line.
