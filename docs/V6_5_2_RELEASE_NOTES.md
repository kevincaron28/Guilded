# Guilded 6.5.2 — Update prompts

Patch release, October 18, 2026. Addon, bot and Windows companion move together to 6.5.2;
protocol remains 2. One new database migration (applied automatically on deploy).
The addon itself is unchanged apart from its version.
In-game results are in the [checklist](V6_2_GAME_ACCEPTANCE.md).

## Windows companion: know when an update is out

- After it starts, then twice a day, the companion looks for a newer stable Guilded release. It
  also compares itself with the bot it talks to, so a guild that updated its own bot prompts
  its members even when GitHub cannot be reached.
- When one is out: a **Download update** banner on Overview, an "Update available" line in
  the tray tooltip and one Windows notification per new version. The button opens the GitHub
  release page; nothing downloads or installs by itself. Your settings and Discord link are kept
  when you run the new installer.
- Installers older than 6.5.2 do not have this check: update them once by hand.

## Bot

- **Self-hosted bots hear about new releases.** Once a day the bot checks the latest stable
  release. When it is newer than the running bot, each server's officer log gets one notice
  per version with the release link (English or French). The official hosted bot skips it;
  `UPDATE_CHECK=false` turns it off.
- **The pairing code stands out.** `/character pair` and `/poe pair` show the connection code
  first, alone in a box that is easy to copy, instead of in bold inside a sentence.

## Database

- Migration `20261118090000_update_notice` adds one nullable column,
  `GuildSettings.lastUpdateNoticeVersion`, so each server is told once per version.

## Website and guides

- Bilingual player guides, an EP/GP guide and project showcases on the website.

## Checked

- Automated: TypeScript, ESLint, the addon validator and the full test suite, with tests for
  version comparison, GitHub being unreachable, one notice per version, the hosted and turned-off
  cases, and the pairing-code box.
- The update banner was checked in a local preview. The Windows notification is checked after
  installing this release on the maintainer's PC.
