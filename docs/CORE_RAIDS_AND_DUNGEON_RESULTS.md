# Core raids and dungeon results (5.0)

Core setup creates dedicated `-butin` and `-rapports` channels. Loot notifications, including newly imported in-game awards, route to the raid's core. `/loot history` and `/report stats` infer the core from its channel; the optional `core` selection also works elsewhere. Core reports exclude guild-wide recruitment counts. Loot operations require a guild-owned raid; a core channel infers its sole active raid, otherwise the officer chooses one.

Core raids have two signup messages: the guild's general signup channel and the core's signup channel. Both use the same raid ID and signup table, with existing core priority and guest/waitlist rules. Updates serialize per raid, adopt existing core posts, and remember both message references. Startup provisions missing core channels and refreshes planned/active posts. A five-minute repair job retries failures and missing posts without repeatedly editing healthy posts.

New in-game raids record the selected core in their export. Import matching includes that core as well as guild and the existing four-hour time window. Older exports without core information retain the previous time-based matching behavior.

`/setup reset` is a full destructive reset option. Only the server owner or an administrator can use it. The private preview includes a complete channel manifest, database counts, channels/roles kept, and the effect on companion pairings. Confirmation requires typing the server name and rechecks administrator permission. Cancellation/timeout cannot later complete an outstanding modal. A failed channel deletion stops before the database wipe. The database deletion and fresh default settings are transactional. A reset timestamp excludes pre-reset and undated local ledger entries, loot, raid and dungeon history when a companion is paired again; upgraded companions include ledger dates. The bot remains in the server; `/setup start` creates a fresh setup. Renamed/admin-chosen channels and roles are preserved as stated in the preview. This update does not itself reset the live guild.

The addon displays a small run-results window after its local dungeon finishes: duration, boss kills and each player's known deaths. Missing death data stays unknown. Points are calculated by the server. The new **Season** page shows official current points and the latest ten archived seasons, with pagination through the top fifty. All older seasons remain stored and accessible through Discord.

The companion fetches standings every two minutes and after uploads. WoW loads the generated file on login/reload, so its displayed update timestamp is the loaded snapshot, not a live connection. Addon-only members receive newer official snapshots from an online guild officer. The guild relay includes the current top fifty and top ten from each of the latest ten past seasons, with sender checks, bounded chunks and a sharing cooldown. Current and past season totals use one shared aggregation; timestamp-only responses do not rewrite the file. Run summaries retry on login and on an officer's request, limited to five own unsynced runs from the past week and a sixty-second cooldown. Server run IDs prevent duplicate points. An online guild officer's paired companion is still needed for members using only the addon.

Validation includes mirrored-post recovery, shared-channel deduplication, serialized updates, reset permission/failure behavior, disposable PostgreSQL cascade and restore checks, official current/past season totals, core import filtering, unknown deaths and trusted-officer replay. Required real-client follow-up: use both signup copies, complete a dungeon, open Season after reload, and verify an addon-only guildmate's run reaches the officer relay. Do not test the destructive reset against the live guild merely to validate the update.


## Setup/reset channel coverage correction

Setup now includes the automatic FAQ channel (`answerChannelId`, `bot-faq`)
with member posting enabled, alongside the general raid signup and member guide.
The setup checklist and channel picker include FAQ; saving it refreshes the
answer listener immediately. Creating missing channels saves each ID before
posting guides, so a partially interrupted setup does not lose its links.

Reset/uninstall previews include the configured general signup, guide and FAQ
channels even if renamed. Known leftover names (including `guilded-addon` and
`raid-inscription`/`raid-inscriptions`) are recognized only in the corresponding
Guilded category or the legacy `⚜️ Guilded` category. Setup reuses those survivors
instead of creating duplicates. Reset can also remove them when the old reset
already erased their saved IDs. Unrelated channels and welcome channels retain
the existing conservative handling. The server-name confirmation still applies;
installing this correction does not itself run a reset.
