# Guilded Games 0.1.0 Alpha

**Only the host needs the addon.**

Published 14 October 2026 as a
[GitHub prerelease](https://github.com/kevincaron28/Guilded/releases/tag/guilded-games-v0.1.0-alpha.1).
The separate CurseForge project 1744752 received its first Alpha submission in
the Games chat. Moderator approval/public availability was not independently
confirmed by this finalization; do not submit a duplicate.

Turn a raid break or a quiet party into a game night. Guilded Games is an
independent WoW addon: players join through ordinary party/raid chat and use
the game's own `/roll`. No Guilded installation, Discord bot, companion or
guild-leader rank is required.

## Games

- **High Roll:** highest roll wins; ties get a visible roll-off.
- **Deathroll:** the lowest roll is eliminated until one player remains.
- **Duel:** alternate rolls using the previous result as the next limit;
  the first player to roll 1 loses.
- **Closest Target:** five rounds; roll closest to the announced target.
- **Trivia:** five questions, solo scoring or teams. English and French
  starter packs each contain ten questions.

Host controls include the lobby, player/turn status, missing rolls, removal,
round advancement, question skipping, cancellation and quick rematches.
The last 50 completed matches are saved locally; the window displays the
latest ten. Games award no gold, currency or Guilded EP/GP.

## Start playing

1. Install the `GuildedGames` folder in `Interface/AddOns` and reload WoW.
2. Join a party or raid and open `/ggames`.
3. Choose a game. Players type `1` in group chat to join.
4. Click **Next round** and follow the instructions in chat.

Use `/ggames lang en` or `/ggames lang fr` for language; reload to refresh
window labels. Anyone can host. Use only one host per group and remain where
the host can see the group's rolls.

## Alpha status

This is an early test release targeting WoW Forever. Automated Lua checks
cover game rules, localized roll parsing, name ambiguity, cancellation,
history and coexistence with Guilded's new loot roll module. Real-client,
two-PC, chat-delivery, combat/reload and compatibility checks remain pending.
The declared interface numbers are not proof of support on other clients.

An active game is abandoned by reload/logout, without saving a result.
Trivia uses the host's message-arrival order; it is not a latency-adjusted
competition. Match history lives in local SavedVariables, not an online
leaderboard. The host is the referee.

Existing Guilded 6.1.2 users should not run its built-in games or loot rolls at
the same time as Guilded Games. The next Guilded candidate separates party
games and prevents overlapping game/loot sessions on one host.

## Feedback and license

Report bugs at https://github.com/kevincaron28/Guilded/issues with the game,
client/version, language, expected result and actual result. Do not attach
private SavedVariables without reviewing them first.

License: PolyForm Noncommercial 1.0.0, included in the download.
Brand artwork was created for this project using OpenAI image generation.
