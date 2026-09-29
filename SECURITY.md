# Security

## Reporting a problem

Please report security problems privately (a Discord message to the guild
owner, or a private GitHub security advisory) instead of a public issue. Include
what you did, what you expected and what happened. Expect a reply within a few
days.

## What to know when you run it

- The **addon** sends nothing over the internet. It talks to other players
  through the game's addon channel and writes a saved file on your computer.
- The **companion app** pairs with `/character pair`. Credentials are scoped to one active member
  in one guild. Re-pairing revokes the old credential. Keep companion config private.
- The shared `COMPANION_UPLOAD_TOKEN` no longer grants access. Every request checks current Discord
  membership/roles. Only officers may upload guild ledgers; personal uploads are allowlisted.
- The **bot** listens on the configured address; put it behind HTTPS when reachable remotely.
  Failed pairing/credential attempts are throttled. The companion refuses credential-bearing
  redirects and remote HTTP. `/health` reveals only readiness/version, not guild data.
- Never share your `.env` / `.env.local` (Discord bot token, database address).
- Officer-only actions are checked on the bot with Discord roles, not by the
  addon, so a modified addon cannot award points.
