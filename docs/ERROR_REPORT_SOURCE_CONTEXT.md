# Finding the source of a developer report

The developer feed uses `ERROR_LOG_CHANNEL_ID`. Its destination is the inbox,
not the affected server. Each saved report retains its short reference and bot
release version. New reports also retain the origin metadata already available
to the failing handler, in the existing ErrorReport context field.

| Failure path | Available context |
| --- | --- |
| `/report bug` or failed slash command | Source guild/channel and fixed command path. Slash submissions have no public source message. |
| Button, select or modal handler | Source guild/channel and handler label; a source message link when the existing message is not ephemeral. |
| Answer-channel or participation message/reaction handler | Source guild/channel/message IDs already on the event; no message-body lookup. |
| Scheduled-event reconciliation, raid signup repair, character display refresh | The guild currently being processed and a fixed operation label, even if its first database lookup fails. No channel is guessed for a guild-wide operation. |
| Guild lifecycle, pilot and participation callbacks | Guild and channel where the callback already has them. Deleted messages retain channel context without a dead message link. |
| Other host-wide/aggregate jobs, process failures, old saved reports | Source guild/channel may remain unknown. Internal service loops require their own scoped context before a specific guild can be claimed. |

The Discord card puts origin, operation, reference and version before the error
detail, so a long exception cannot truncate the source information. Identical
automatic failures in different guilds/channels/operations have separate live
deduplication keys. Delivery/retry policy is otherwise unchanged.

`npm run bugs` shows the source links/operations for new reports and continues
to read older screenshot-only context values. It cannot recover source metadata
that an older report never recorded. A source link is useful only to someone
who already has permission to view that channel; it grants no access.

This change requires no migration, new setting, permission, privileged intent,
message fetch, attachment download, command-argument capture or member-profile
collection. It persists only the IDs and fixed operation labels already being
processed alongside the existing report. Report contents, retention and private
inbox configuration keep their existing policy. Configure the developer feed
only to a reviewed private destination.
