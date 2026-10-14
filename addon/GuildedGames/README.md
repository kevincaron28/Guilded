# Guilded Games - development preview

Only the host installs this addon. Players join the same party or raid and
type `1` in its chat. No Guilded, Discord, companion, guild rank or library is
required. Games are just for fun; no gold or EP/GP is involved.

Install the `GuildedGames` folder in `Interface/AddOns`, then `/reload`.
Open `/ggames`. Choose a game, let players join, then click **Next round**.
The host joins with **Join myself**. Use a character's full name-realm in the
player field when names are ambiguous.

- High roll: highest `/roll 100` wins; tied players roll again.
- Deathroll: lowest roll is eliminated; tied low players roll again. Each
  subsequent round uses the previous lowest limit, never less than 2.
- Duel: enter the opponent's name. Host starts `/roll 100`, then alternate
  rolls up to the previous result. First to roll 1 loses.
- Closest target: five rounds, `/roll 100` closest to the announced target
  scores. Equal distances each earn a point. Highest total wins.
- Trivia: five questions from a ten-question English/French starter pack.
  One answer per joined player per question; first correct answer received
  by the host scores. **Skip question** reveals the answer without a point.
- Team trivia: alternating A/B team assignments in join order; teammates'
  points add together. Tied final scores share the win.

The host window shows players, scores, turns and missing rolls. `out` leaves
the game. **Remove player** abandons the current round without awarding a
point; fewer than two active players cancels the match. Rematch returns the
previous participants who are still grouped to a new lobby. Any group change
that changes chat channels cancels the session rather than sending old prompts
to a different group. Use one host per group; multiple hosts are not negotiated.

History keeps the last 50 completed matches on this WoW installation (the
window shows the latest ten). Reload/logout abandons a live match, with no
result saved. History persists through SavedVariables after reload/logout.
English/French follows the client; `/ggames lang en` or `/ggames lang fr`
changes chat/question language. Reload to refresh window button labels.

The host is a referee, not a trusted game server. Trivia follows arrival order,
not a network-latency-adjusted race. Keep the group together/in range so the
host can see rolls. No cross-realm short-name guessing is performed.

Preview 0.1.0 needs real-client checks on WoW Forever: English/French system
roll messages, ordinary players without the addon, raid/party chat, combat,
reload, leaving players, both addons installed, and window layout. Automated
Lua tests do not establish those passes. Do not publish this as a stable build.
