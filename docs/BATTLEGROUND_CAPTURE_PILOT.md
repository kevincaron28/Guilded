# Personal battleground capture pilot

This source is a provisional Forever adapter, not real-client acceptance and
not part of frozen 8.3.0 files. Forever validation requires its November 4 opening.

8.5: there is no consent switch any more. Where the client supports it (the adapter checks below),
the addon captures your own postmatch results automatically and everything is shared in the guild's
battleground statistics. `/guilded bgcapture` only shows the status (and `premade <code>` still sets the
unverified premade hint). The Discord `/bg privacy` command was removed. WoW must save
SavedVariables through reload/logout before Companion can read the records.

The adapter requires Forever edition identity, a readable negative Hardcore
check, and readable match state/duration/bracket/mode capabilities. Missing or
secret values stop capture. Other editions are disabled. A normal-realm command
alone cannot override the Hardcore capability check.

Only the current player's completed-match result and minimal match context are
exported. No opponents, scoreboard enumeration, damage/healing/honor rating,
automatic awards or channel messages are generated. Durable local report IDs
survive reload and duplicate completion events. They are reporter-local IDs,
not a universal cross-client match identifier.

Optional `/guilded bgcapture premade <code>` sets a manually shared grouping
hint for the next successfully captured result only. Capture must already be
enabled. Use 8-100 case-sensitive ASCII letters, digits, underscores, colons or
hyphens; teammates must enter the same code themselves. Status shows your own
pending code. It is consumed after capture and cleared on disable or login/reload,
and never sends peer messages. A shared code does not verify a match or bypass
server consent, ownership, or provisional-evidence checks.

The bracket field preserves the raw `C_PvP.GetActiveMatchBracket()` identifier.
Use the identifier shown in your private `/bg result` when filtering statistics;
it is not a verified level range such as `10-19`. No cross-edition bracket mapping
is inferred before client acceptance.

Backfill and reload uncertainty are retained. An early exit with no readable
completed match result creates no result; it is never invented as a loss or win.
Completed results remain provisional server-side until adapter acceptance.
The recorder bounds retained history to the latest 100 local records. It does
not claim that pruning is a server acknowledgment. Companion exports whitelist
the protocol and exclude revoked consent and arbitrary SavedVariables fields.

API reference: [pinned Blizzard UI documentation mirror](https://github.com/Gethe/wow-ui-source/blob/ca8368f2f2380cbe696854f7f2646387c278a61b/Interface/AddOns/Blizzard_APIDocumentationGenerated/PvpInfoDocumentation.lua).
