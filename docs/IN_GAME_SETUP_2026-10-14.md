# In-game-only setup — 14 October 2026

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
Manual local core/roster management remains future work; no roster is inferred
from the guild or filled with sample players.

Real-client acceptance required: /guilded setup opens out of combat; both
choices fit the frame; In-game only changes Home/sidebar saving labels;
standings shows the expected local/core/guild view; Connected restores the
connected prompts; /reload retains the choice and existing guild records.
Do not mark this check passed from Lua mocks.
