# Message earning coverage — 28 October 2026

The owner asked whether messages count in every channel. Read-only production
checks found an active Québec Gold Discord season with earning and `allText`
enabled, five message awards in the preceding 24 hours, and a recent award at
16:21 UTC. Existing limits were ten message points/day, one per five minutes,
three days of server membership and seven days of account age. No points or
settings were changed by this audit.

Discord permissions showed 92 relevant channels visible to the existing bot,
including 72 ordinary text channels, plus one accessible active thread. No
missing View Channel permission was found. Names, IDs and raw settings remain
in ignored private evidence under `backups/`.

The actual gap was `GuildText`-only filtering in the gateway tracker. The fix
uses one shared channel predicate for message and reaction earning. All-channel
mode now accepts text/announcement/voice/stage messages and public, private and
announcement threads. Forum/media posts arrive as threads. DMs, categories and
forum parent objects do not generate direct message awards. Private-thread
membership is checked explicitly because discord.js returns parent permissions;
a permission or membership lookup failure denies the award. No automatic joins,
new intents, permission grants or audio collection are introduced.

Restricted lists still match exact channel IDs. Cooldowns, daily caps, audience,
account/member age, text fingerprints, stable references, deletion reversals,
frozen history and voice-time rules are unchanged. There is no retroactive award
or reset. Québec Gold already uses all-channel mode, so no live configuration
change is needed after deployment.

Officers get `/participation channels [season] [page]`: a private, 20-row report
of eligible, excluded, paused or inaccessible channels, including forum/media
parents and reaction-history warnings. Only channels visible to the officer are
shown. Private threads are not exposed through parent permissions. Report reads
and rule explanations do not grant access or guarantee a point for each message.

Validation: 338 files / 2,835 tests passed, TypeScript, ESLint and both addon
validators. Coverage exercises every supported message channel type, the shared
cross-channel cooldown, exact restricted IDs, private membership failures,
reaction deduplication/deletion reversals and officer-visible report boundaries.
This is a bot-only 8.0 correction; published addon/installer bytes remain unchanged
and protocol remains 2. [PR #250](https://github.com/kevincaron28/Guilded/pull/250)
passed quality run `40732004968`; merged main `4e23dac` passed push CI
`40732685873`. Production preflight, database/application backup and encrypted
off-server verification passed before activation. The pinned source was staged
with the existing deployment helpers, activated once, and the old application
retained privately for recovery. No migration or Caddy/service change was needed.
Post-deploy ledger check passed; public health is 8.0.0 / protocol 2 / commands ok.
Discord REST confirms `/participation channels`, its French description and the
updated all-text option in the primary guild. Public routes work and direct origin
health, companion and API requests still return 404. No new live member message or
reaction was manufactured; channel-type awards are covered by the automated tests.
Private recovery/registration evidence: `backups/participation-2026-10-28/`.

References: [Discord threads](https://docs.discord.com/developers/topics/threads),
[permission overwrites](https://docs.discord.com/developers/topics/permissions).
