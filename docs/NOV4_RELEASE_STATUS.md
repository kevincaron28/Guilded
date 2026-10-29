# November 4 release status

Checkpoint: 29 October 2026. This checkpoint supersedes earlier statements that
the entire 8.1.0 candidate is undeployed. Stable publication remains planned for
November 4 in America/Toronto. All in-game testing is deferred to launch by the
owner; unperformed gameplay and two-PC checks are not passes.

## Verified source and deployment

Backend and online companion source is `6bdc80e97dd8294bb4226774dfc15c2552385706`,
including PR #275. [Exact-main CI](https://github.com/kevincaron28/Guilded/actions/runs/40947760250)
passed Linux quality, disposable PostgreSQL pricing/permissions/revision/import
and restore checks, Windows packaging and production Worker checks. The Worker
build is `18bcade5-d079-4a96-8bc6-242d023a3041`.

The single Oracle service was updated under its exclusive lock after fresh
unique-ledger checks, database/application backup, restore-list validation and
authenticated encrypted off-server checksum verification. Recovery snapshot:
`2026-10-29T20-20-49-787Z`. All 483 compared tracked application and companion
files matched source. Migration `20261128000000_raid_pricing_policy` completed.
Health reported 8.1.0, protocol 2 and commands OK; twelve public route probes
passed and unauthenticated direct-origin health remained 404.

Authenticated browser verification covered pricing and leaderboard pages,
English/French, refresh, calculator rounding and invalid input. Empty live
boards matched the actual empty roster; populated/tied boards and writes were
verified in the isolated database suite, not by adding production balances.
Battle.net US Retail consent, discovery and explicit private persistence were
verified in the preceding deployment. This does not establish Forever API support.

## Available clients

[GitHub candidate 1](https://github.com/kevincaron28/Guilded/releases/tag/v8.1.0-rc.1)
contains 21 assets from the deployed source. All anonymous downloads matched
their expected sizes and SHA-256 hashes; the tag resolves to that source.
The app version is 8.1.0, with candidate release metadata. Choose the ZIP for the
actual WoW edition. Existing stable 8.0.2 assets remain unchanged.

The optional standalone Windows installer is 123,014,900 bytes, SHA-256
`5cab6d054c458a131f27210e088d79ac5eb28dcf9fbcd7a5821425642200a349`.
It is unsigned and is not a Microsoft Store update. The implementation chat
verified the standalone 8.0.2-to-8.1.0 upgrade, the native version/navigation and
unchanged encrypted standalone and Store profile bytes. The Store installation
remains 8.0.2. A pre-existing rejected credential and old Retail test-file path
are setup follow-ups, not evidence of a successful sync or a new update regression.

Stable GitHub, CurseForge and Store provider links must continue to identify
their actually published versions. Do not replace published candidate bytes,
promote candidate links as stable, or update provider records from an upload
attempt alone. Later executable changes require new source checks and artifacts.

## Remaining release gates

Store Submission 5 (`1152921505702272559`) entered certification on October 29.
The portal confirms **manual publication hold**: publication starts only after
selecting Publish now. Reserved-identity package 8.1.0.0 is 165,392,859 bytes,
SHA-256 `8316b779e6a815d37bf8bb412441178538a513b4a1632770cdd5009974082404`.
It was built from `6bdc80e`, verified against source and uploaded with English and
French update notes. It is not yet certified, published or installed from Store.

- Store reserved-identity 8.1.0.0 package, certification and manual publication
  hold must be tracked separately from the standalone installer. Certification
  and actual Store upgrade/signature/profile verification are separate gates.
- Prepare final release metadata, exact-source CI and verified packages before
  stable publication. Refresh recovery evidence before any further deployment.
- Publish and verify stable GitHub assets, then correct-edition CurseForge
  submissions and downloads; advance site provider records only after proof.
- Microsoft and CurseForge control approval timing. Never report a pending
  submission as published. Keep Store publication held until launch coordination.
- On launch day perform real client load/reload, import/undo, paired sync and
  pricing/award reconciliation using preserved SavedVariables. Do not alter real
  balances merely to manufacture acceptance evidence.
- Verify newly available Forever item/API data before asserting coverage; unknown
  prices remain provisional and require explicit officer confirmation.

UX follow-up: users can confuse **Raid prices** (preset, slot prices and
calculator) with **Cores & prices** (roster, general rules and item exceptions).
Clarify the labels and cross-links in a later reviewed client change; the
currently packaged source is unchanged. Tracking pause is in Connection & setup,
step 3. Preserve the final client source during Store certification.

Private receipts are retained under `backups/pr275-deployment/`,
`backups/client-8.1.0-rc1/` and `backups/store-8.1.0/`. These may contain operational
details and are not committed. The implementation chat owns authenticated client
verification and owner gameplay instructions; release publication is coordinated
here to avoid concurrent changes.
