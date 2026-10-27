# Finding the source of a developer report

The optional developer feed uses `ERROR_LOG_CHANNEL_ID`. Its destination is the inbox,
not the affected server. Each saved report retains its short reference and bot
release version. New reports also retain the origin metadata already available
to the failing handler, in the existing ErrorReport context field.

| Failure path | Available context |
| --- | --- |
| Confirmed `/report bug` | Previewed sanitized text, reporter ID, source guild/channel and fixed command path. No attachment or conversation capture. |
| Failed slash command, button, select or modal | Source guild/channel and handler label. Automatic reports omit reporter and message IDs. |
| Answer-channel or participation message/reaction handler | Source guild/channel IDs already on the event; no message-body lookup or message link. |
| Scheduled-event reconciliation, raid signup repair, character display refresh | The guild currently being processed and a fixed operation label, even if its first database lookup fails. No channel is guessed for a guild-wide operation. |
| Guild lifecycle, pilot and participation callbacks | Guild and channel where the callback already has them. Deleted messages retain channel context without a dead message link. |
| Other host-wide/aggregate jobs, process failures, old saved reports | Source guild/channel may remain unknown. Internal service loops require their own scoped context before a specific guild can be claimed. |

The Discord card puts origin, operation, reference and version before the error
detail, so a long exception cannot truncate the source information. Identical
automatic failures in different guilds/channels/operations have separate live
deduplication keys. Notifications require a freshly verified administrator-only
text channel where the bot can send; public, DM, thread or unverifiable audiences
are denied without a fallback. Storage remains available when notification is denied.

`npm run bugs` shows the source links/operations for new reports and continues
to read older screenshot-only context values. It cannot recover source metadata
that an older report never recorded. A source link is useful only to someone
who already has permission to view that channel; it grants no access.

This change requires no migration, new setting, permission, privileged intent,
message fetch, attachment download, command-argument capture or member-profile
collection. It persists only the IDs and fixed operation labels already being
processed. Automatic errors keep class, approved error code, fingerprint and up
to twelve basename/line stack frames, not arbitrary exception text or objects.
Console error/warning strings become fingerprints; raw objects are omitted.
Member reports require a private preview and Send confirmation. The duplicate
officer-channel forwarding and screenshot input have been removed. Existing
historical reports and retention policy are unchanged; this is not a retroactive
redaction or deletion of old rows. See
[privacy and client acceptance](DIAGNOSTIC_PRIVACY_AND_CLIENT_ACCEPTANCE.md).
