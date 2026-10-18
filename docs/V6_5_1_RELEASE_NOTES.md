# Guilded 6.5.1 — Simpler companion connection

Patch release, October 17, 2026. Addon, bot and Windows companion move together to 6.5.1;
protocol remains 2. No database migration. The addon itself is unchanged apart from its version.
In-game results are in the [checklist](V6_2_GAME_ACCEPTANCE.md).

## Companions (online and Windows)

- **Connect with the code alone.** Type `/character pair` (or `/poe pair`) in Discord, paste the
  private code in **Connection & setup** and press **Connect**. The bot finds your server from
  the code, so you no longer need Discord Developer Mode to copy a server ID. The server ID
  field moved to **Advanced preferences** and fills itself in; it is asked for only if one code
  ever matches two servers.
- The online companion shows its real version. It always said 6.1.0.
- **Disconnect this browser** only appears once the browser is connected.
- Pressing **Connect** with an empty code says what to paste instead of sending a request.

## Bot

- The pairing endpoint accepts a code without a server ID and returns the server it found.
  Older companions that still send the server ID work unchanged. Wrong codes still count
  toward the per-address failure limit, and the hosted-pilot check still applies.
- `/character pair` and `/poe pair` (English and French) no longer tell members to check
  the server ID.

## Checked

- Automated: TypeScript, ESLint, the addon validator and the full test suite, with new tests for
  code-only pairing in the bot, the online companion and the Windows engine.
- The online page was checked in a local preview. A real code-only pairing on the live site is
  checked after deploy.
