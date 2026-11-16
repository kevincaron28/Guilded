# Compatibility policy: older addons and companions keep working

Guilded ships four parts that members update at different times (the bot is ours, the addon and the
companion are theirs). Members who have not updated yet must keep working, so every release follows
these rules.

## The support window

- **N-2 minor releases** for the addon and the companion. While the bot is 9.3.x, a 9.1.x, 9.2.x or
  9.3.x client must sync, upload and display correctly. Patch releases inside a minor count as one.
- The oldest release still inside the window is `MIN_COMPANION` in `src/compat.ts` (now `9.1.0`, the
  zero-setup companion). Raise it only when a release leaves the window, in the release that moves it.
- A client older than that is not blocked. The bot tells it (`minCompanionVersion`, and
  `updateRequired` where the answer is per client) and the companion shows its ordinary
  `companion-outdated` problem.
- Addon-to-addon messages follow the same window: a current addon must read what the oldest
  supported addon sends, and ignore kinds it does not know.

## Wire changes are additive only

1. New fields are **optional or have a default** (zod `.optional()` / `.default(...)`). Never required.
2. New addon messages use a **new kind** (`NEWKIND|...`); handlers already ignore unknown kinds.
   Never change the field order or meaning of an existing kind: append a field, and parse it as optional
   (a `DIG` without its newest fields still works).
3. New bot features a companion may use are announced in `COMPANION_FEATURES`
   (`src/services/standings-feed.ts`); a companion only uses what it was told about. Never remove an entry.
4. SavedVariables changes get a migration in `Core.lua` and keep reading the old shape.
5. **Removal** of a field, message kind, feature or endpoint happens only after it has been unused for two
   releases (the window), in a release that says so in its changelog.

## Protocol version

- `PROTOCOL_VERSION` and `MIN_PROTOCOL` live in `src/compat.ts` and the bot advertises both
  (`protocolVersion`, `minProtocol`). The companion accepts a bot when the ranges overlap
  (`protocolSupported` in `companion/request.mjs`; it knows 2 to 2 today).
- An additive change does **not** bump the protocol. Raise `PROTOCOL_VERSION` (keeping `MIN_PROTOCOL`)
  only to offer something new that supporting companions understand. Raise `MIN_PROTOCOL` together with
  `PROTOCOL_VERSION` only for a deliberate break, after the old protocol has left the support window.
- Dungeon runs carry their own `protocolVersion` (`SUPPORTED_PROTOCOLS`, `src/services/dungeon-rules.ts`); the same rules apply.

## What tells us who is out there

- The companion sends `x-companion-version` (and `x-companion-addon-version`, the addon release that
  wrote the saved file it uploaded) on every API request. Names under `x-companion-*` pass the Cloudflare
  Worker (`worker/index.mjs`) without a change.
- The bot counts requests per companion version in memory and logs one line an hour
  (`Companion versions in the last hour: 9.3.5 x12, 9.1.3 x2`). Use it before raising `MIN_COMPANION`.

## Guard rails in the test suite

- `tests/compat-replay.test.ts` replays `tests/fixtures/compat/<version>/` (signed export, dungeon run,
  unsigned device upload, gzip variant) against the current schemas.
- `tests/lua/compat-old-messages.test.ts` feeds old addon messages to the current handlers.
- `tests/compat-guard.test.ts` fails if a `COMPANION_FEATURES` entry disappears or a field in the
  addon-import, character, dungeon-run or device-upload schemas is removed or becomes required.
  The baseline is `tests/fixtures/compat/wire-shape.json`; a deliberate change adds the item to its
  `allow` lists (a policy decision, in the pull request description).

## Adding a compat fixture

1. After each minor release (or whenever a wire shape changes), make
   `tests/fixtures/compat/<version>/` with: `addon-export.json` (the body `{ guildDiscordId, export }` an addon
   plus companion of that release uploads), `dungeon-run.json` (one run), `device-upload.json` (the unsigned body).
   Build them from what that release really sent: `git show v<version>:src/integrations/addon.ts` shows which
   fields existed, and a saved file from that release is the best source. Use only invented names and ids.
   The 9.1.3, 9.2.0 and 9.3.5 fixtures in the repo were **built from the schemas at those tags, not captured from real
   saved files**. To add a captured one: take the saved file a real client of that release wrote, run it through that
   release's companion export (or copy the body the companion uploaded), replace every real name, realm, guild and id
   with invented ones, and drop it in the folder with the same three file names. Prefer captured fixtures when you have them.
2. The replay test picks the folder up by itself. If the new release adds fields, the old fixtures must still pass unchanged.
3. When a schema changes on purpose, refresh the baseline with (it refuses, and lists them, any removed or newly required field not already in the `allow` lists of that file: add them there first)
   `COMPAT_WRITE=1 npx vitest run tests/compat-guard.test.ts` and review the diff of `wire-shape.json`:
   new optional fields are fine; anything else needs an `allow` entry.
4. Update the window: when a release leaves it, delete its fixtures only after `MIN_COMPANION` has moved past it.
