# In-game-only setup — 14 October 2026

Default-mode follow-up: new source selects **In-game only** automatically for
fresh/unconnected installations and does not force a chooser on login. A saved
snapshot marked as coming from the companion, or a companion standings file,
retains connected setup. In-game officer snapshots and legacy snapshots without
a known source keep addon-only setup; a timestamp alone does not prove a Discord
connection. Explicit choices are retained. `/guilded setup` still
offers both modes. Character linking in Discord is optional and works with
`/guilded character` → `/character import` without a companion; companion codes
are issued only when that separate connection is requested. Fresh-profile
main/alt service tests and the real Lua harness cover these paths. A new-client
install/reload test of this follow-up remains pending; the previously confirmed
chooser acceptance below applies to the published 6.1.1/6.1.2 behavior.

6.1.1 introduces a first-run chooser for installations without a connected
standings snapshot. Existing connected users keep their experience. Open it
again with /guilded setup or Home > Guilded setup. The explicit local and
connected commands are /guilded setup local and /guilded setup connected.

This is a setup/UI preference, not a permission bypass, network firewall or a
new ledger. It preserves existing records and core rules. A previously running
companion must be paused separately if the owner wants to stop uploads.

Fresh installations can use local gear checks, dungeon recording, raid
attendance, loot and officer ledger publication without Discord or core
signups. Scores clearly distinguishes recording from verified online seasonal
rankings. Local ledger characters are visible before an officer publishes.
The published 6.1.2 client does not include local core/roster administration.
That feature is implemented in the next-version preview described in
[the standalone candidate notes](../V6_2_STANDALONE_AND_GAMES.md); no roster is
inferred from the guild or filled with sample players.

If an older build already chose Connected from an in-game officer snapshot,
select `/guilded setup local` once. The fix preserves explicit saved choices
instead of guessing which existing Connected choices were unintended.

Real-client acceptance required: /guilded setup opens out of combat; both
choices fit the frame; In-game only changes Home/sidebar saving labels;
standings shows the expected local/core/guild view; Connected restores the
connected prompts; /reload retains the choice and existing guild records.
Do not mark this check passed from Lua mocks.

Owner acceptance, 14 October 2026: confirmed /reload, setup opens, both choices work, Home save prompts change and restore, and existing data remains intact. This does not claim unrelated two-PC or gameplay follow-up passed.
