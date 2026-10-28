# Guilded 8.0 engineering completion

The owner requested completion of these seven audit items before release on
28 October 2026. Remaining hands-on game testing is explicitly waived; automated
checks, backup, CI and deployment verification remain required.

## Shared inbound validation and Core separation

`Transport.lua` is loaded by both addons. Every addon-message receiver uses its
common length, channel, restricted-value and sender boundary. Existing officer,
guild, group, participant, revision, session, checksum and stable-ID checks remain
in their modules. Checksums detect corruption; they do not establish identity.
Wire protocol stays 2, preserving installed peers. Repeated ledger IDs and void
markers retain their existing replay protection. The offline Lua suite exercises
forged sender, replay, reordered packets and cross-edition handling.

`CorePresentation.lua` owns spreadsheet serialization and localized roll parsing.
Core supplies the active database and identity helpers; public functions retain
their existing behavior. This is a bounded extraction, not a rewrite of accounting.

## Ledger retention and lossless storage compaction

All financial ledger entries, void markers, IDs, timestamps, unknown fields and
legacy numeric positions are retained indefinitely. No automatic pruning or
balance checkpoint replaces the history. Stable import references remain intact.

Preview with `npm run ledger:compact -- --input "path/to/Guilded.lua"`. To apply,
close WoW normally, then add `--apply --game-closed`. The tool rejects extra globals,
parses within the normal size/node limits, removes only insignificant formatting,
verifies the entire parsed value, writes and hashes a full recovery copy, and
checks for concurrent changes before atomic replacement. Keep the returned backup.
The report shows bytes saved and retained ledger rows. A file already compact
is left alone. No actual player's file is modified as part of release preparation.

This reduces serialized storage without deleting records; it does not bound the
financial history or reduce the number of live Lua records. WoW may format the
file again on its next save. Review unusually large history before raising parser
limits. Reconcile/import/export archives before considering future history pruning.

## Versioned Retail overtime scoring

New Retail season snapshots use `guilded-keystone-v2`. Existing v1 snapshots are
immutable. Evidence policy remains `current-v1`; independent-uploader enforcement
remains deferred by the owner's earlier decision.

V2 accepts eligible, natively completed keys up to 40% overtime, retaining a
linearly reduced 100% to 50% of base points with no speed bonus. A +10 has 320 base
points: 20% overtime gives 240, 40% gives 160, and later completions score nothing.
Abandoned, practice, inconsistent-timer, wrong-pool and unverified runs do not
qualify. Each dungeon contributes its best score once across affix sets and roles.
Raw affix leaderboards remain restricted to timed runs. EN/FR guild and public
rating views explain the snapshot's policy. This is Guilded's provisional formula,
not an official Blizzard or Raider.IO score.

## Origin isolation

The Worker authenticates upstream HTTPS requests with a separately provisioned
256-bit origin token. Caller-supplied origin headers are discarded. The hosted
Caddy gate rejects requests without that token; log filters remove it. Personal
credentials and authorization remain required by the bot. The optional external
Caddy snippet survives updates; independent hosts have no gate unless configured.

Deploy the Worker and verify public routes before activating the Caddy gate.
Validate before reload and preserve the preceding configuration for recovery.
Companion 8.0 migrates only the retired `guildedqc.duckdns.org` address to
`guilded.kcaron.top` before attaching credentials. Users of older companions with
that retired address must update or use the public online companion. No redirect
forwards their credentials. Local service health remains available on loopback.
Activation evidence is separate from the implementation and configuration review.

## French indexing

The Worker translates authored bilingual HTML before returning it, including
language, titles, descriptions, accessible labels, visible language sections,
internal links and canonical URLs. It retains security headers. Bilingual pages
advertise English/French/x-default alternatives; both sitemaps include French
URLs. Existing guide French sections retain their language attributes. Native
workerd tests verify translation without executing browser JavaScript.

## Accessibility

The rendered WCAG/keyboard/reflow review and its practical limits are recorded in
`V8_0_ACCESSIBILITY.md`. Corrected accessible brand labels and the connection-name
field. This audit is evidence for checked states, not a claim of universal
accessibility or certification.
