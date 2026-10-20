# Guilded 7.2.0 — Sign in with Discord, one-click companion updates and a calmer website

Feature release, October 19, 2026. Addon, bot, Windows companion and Guilded Dungeons move to
7.2.0; protocol remains 2. No database migration. In-game results are in the
[checklist](V6_2_GAME_ACCEPTANCE.md).

## The companion stays optional

- Addon-only guilds need nothing else: the addon already shares EP/GP, loot and standings in game.
  Companion setup now starts with **Do you need to connect?** and says so.

## Sign in with Discord

- In the companion (Windows app or online), **Sign in with Discord** replaces copying a code. Your
  browser opens guilded.kcaron.top; check that it shows the same short code as the companion, then
  choose one of your Guilded servers or **public dungeon leaderboards only**.
- Servers are listed only when the bot sees you in that Discord server. Your own characters link on
  your first sync, as before. `/character pair` and the /me/ code still work as a fallback, and for
  bots without website sign-in.

## Update now (Windows companion)

- When a new release is out, **Update now** downloads the installer from the GitHub release, checks
  it against GitHub's SHA-256 checksum, installs it and restarts the companion. Settings, the Discord
  link and unsent data are kept. Start with Windows is no longer turned off by an upgrade.
- This works from 7.2.0 on: install 7.2.0 itself once from the release page.

## Website

- One menu on every page, including leaderboards, recruitment and My page (Features, Guides,
  Leaderboards, Recruitment, Download, Companion). Shorter home page, features page and guides.

## Checked

- Automated: TypeScript, ESLint, both addon validators and the full test suite, including the sign-in
  requests and page (code check, CSRF and origin, one use, expiry, French), the companion polling, the
  installer checksum and size checks, and a new parse check of the companion's own scripts.
- To check with real clients: Discord sign-in from the Windows app and the online companion, and the
  first one-click update (7.2.0 to the next release).
