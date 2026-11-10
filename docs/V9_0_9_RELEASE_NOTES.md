# Guilded 9.0.9 — release notes (9 November 2026)

Invite buttons that work, uploads that no longer collide, and downloads from the website. Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## In game (addons)

- **Invite buttons work again.** Every guild and party Invite button is now a secure `/ginvite` or `/invite` macro
  button, so one click invites without a "blocked action" popup. (#681)

## Companion

- **Uploads survive collisions.** If two connections send the same file, the companion retries instead of failing,
  and uploads wait in a queue. (#682)
- **Wrong-server warning.** The companion tells you when it is linked to a different server than you expect, and
  "Remove this server" cleans it up. (#682)
- **Downloads come from the website**, not GitHub, so they no longer time out. (#683, #680)

## Discord bot and website (deployed with this release)

- Smaller addon-import records, harder pruning and lighter backups, after the overnight memory incident. (#679)
- Real in-game screenshots on the features page. (#678)

## Still owed

The Invite buttons and the wrong-server flow on a real client.
