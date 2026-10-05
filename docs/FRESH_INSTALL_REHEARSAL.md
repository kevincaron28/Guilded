# Fresh installation rehearsal — 5 October 2026

Scope: the owner requested a clean local rehearsal first, before using a new
Discord server. This is not a live fresh-guild acceptance pass.

## Findings and fixes

1. **First-start blocker:** copying `.env.example` and filling the four required
   settings still failed configuration parsing because blank optional Warcraft
   Logs/error-report values were rejected. Blank optional values now mean disabled.
2. **Missing early feedback:** `npm run setup:check` now checks required settings,
   numeric Discord IDs, PostgreSQL URL shape, the supplied proxy/API match, Node
   and the web build. It reports field names without printing secrets. It does
   not connect to Discord or a database, or start the bot.
3. **Confusing hosting instructions:** replaced maintainer-specific addresses and
   old version examples with an independent Ubuntu installation path. The guide
   distinguishes addon ZIP, companion installer and matching bot source.
4. **Download documentation:** the addon ZIP now includes `Guilded/INSTALL.md`,
   generated from the current member guide. The addon README uses the verified
   Forever beta folder guidance instead of assuming `_forever_`.
5. **Setup expectations:** `QUICK_START.md` separates a 5–10 minute addon target,
   10–15 minute member target, and a roughly 30-minute owner target after the
   database/server/DNS prerequisites. These are estimates, not measured acceptance.
6. **Installer feedback:** rejects a URL/path passed as a hostname and installation
   over an active Guilded service; installs rsync explicitly and prints the offline
   check, public URLs and Discord checkpoints.

## Clean local evidence

Environment: Windows, Node 24.17.0, npm 11.13.0. Copied only selected source files
into `backups/fresh-install-2026-10-05/`, without existing node_modules, generated
assets, real environment files, credentials or installed application data.

- Root `npm ci --offline --no-audit --no-fund`: 216 packages installed in 43 seconds.
- Companion `npm ci --offline --no-audit --no-fund`: 235 packages installed in 10 seconds.
- Browser companion/icon build: passed from the clean copy.
- Prisma client generation: passed without connecting to a database.
- TypeScript check: passed from the clean copy.
- Addon ZIP: built and verified, 38 files including installation instructions.
- Windows NSIS companion installer: built successfully from the clean source;
  installer execution was not part of this rehearsal.
- Unfilled example: `setup:check` exited 1 and listed the four required settings.
- Example with four dummy test values: `setup:check` exited 0 with optional fields
  left blank. No bot was started; the dummy token was never authenticated.
- Git Bash syntax check of `deploy/setup-server.sh`: passed. This only parses the
  script; it does not prove Ubuntu package installation, systemd or firewall behavior.
- Checked 60 local links across ten setup/entry guides; all targets exist.

The dependency downloads used this machine's cache. Their duration is not an
internet download benchmark or a non-developer-PC installation time.

## Repository validation

`npm run release:prepare` completed successfully, including the rebuilt addon,
browser companion and Windows NSIS installer. Release notes and SHA-256 sums in
`dist` were refreshed for these local artifacts. Nothing was deployed or published.

The updated source passed 151 test files / 1,216 tests, TypeScript, ESLint and
addon static validation. Both npm audits reported zero vulnerabilities. The
new tests cover blank optional settings, missing required settings, invalid
Discord IDs/proxy settings and preflight output that does not expose credentials.
The rebuilt addon ZIP was inspected: version 6.0.0, current member instructions,
no Raid tools TOC entry, and no environment/config/SavedVariables files.

Later on 5 October, the illustrated owner guide, static download/setup website
and online companion connection-check fix were added. A new full release check
passed **151 files / 1,219 tests**, both audits (zero vulnerabilities), TypeScript,
ESLint, addon validation and all package/site builds. See
[online companion verification](ONLINE_COMPANION_CHECK.md) for the live 5.0.0
finding, local 6.0.0 coverage and remaining authenticated-browser checks.

## Still required

- Fresh Ubuntu deployment with a separate real database, application and Discord guild.
- Empty-database migration and restore against PostgreSQL; final-commit CI.
- Actual bot invite/login, role hierarchy, wizard channel creation and ordinary-member access.
- Public DNS/HTTPS reachability from a second PC, pairing, upload and standings return.
- Windows installer execution, upgrade/recovery/uninstall on a non-developer PC.
- Public download availability and checksums, followed by a timed novice walkthrough.

The owner confirmed the 6.0 addon is installed on both existing test PCs. That
confirmation is recorded separately in `V6_0_RELEASE_TESTING.md`; it does not
substitute for a fresh guild, a new companion installation or the remaining raid checks.
