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
and protocol remains 2. Source CI, backup, deployment and live command registration
are separate gates; record their exact results after completion.

References: [Discord threads](https://docs.discord.com/developers/topics/threads),
[permission overwrites](https://docs.discord.com/developers/topics/permissions).
