# November 4 release candidate — 29 October 2026

> Current deployment, prerelease and remaining gates are recorded in
> [the release checkpoint](NOV4_RELEASE_STATUS.md). The preparation observations
> below are historical; they do not override that newer checkpoint.

## Candidate scope

Version **8.1.0**, channel **candidate**, protocol **2**. Target: 4 November 2026 in America/Toronto. Preparation branch: `codex/nov4-release-candidate`, based on merged main `53b0901a8ca6670155a1a8d53b543e7f19df3a33`. The final PR head and its exact-source CI identify the candidate; any later source change invalidates that evidence until rechecked.

Includes the confirmed RCLootCouncil/Gargul importer from [PR #265](https://github.com/kevincaron28/Guilded/pull/265), signup changes from #264 and reliability/audit corrections from #262/#263. Published 8.0.2 bytes and site provider records remain unchanged. This preparation does not deploy a bot, install a companion, publish a release or submit Store/CurseForge files.

The automatic-sync implementation adds independent named devices, enabled background
profiles with controlled addon writes, and optional private Battle.net character
selection. See [implementation and coordination](AUTOMATIC_SYNC_HANDOFF_2026-10-29.md)
and [Blizzard setup](BATTLENET_SETUP.md). Its additive migration and backend routes
must precede client distribution. Battle.net is disabled until configured; live
OAuth and edition availability remain unverified. Claude's edition PR #268 is
merged; his raid/DPS PR #269 is independently coordinated. Any combined source
needs fresh exact-commit CI, including PostgreSQL and Windows packaging.

## Readiness assessment

No additional missing core feature is established as a launch blocker. The earlier HTTP 530/1016 origin blocker was resolved and remains under bounded observation. Retail vault/simulation integration and automated trading remain deferred; they are not justified requirements for the Forever launch.

The candidate still needs final exact-source CI and package verification. Launch publication additionally needs the gates below at the time of release. These are release execution requirements, not evidence that a new product defect was found.

## Gates and evidence

| Gate | Candidate preparation / launch requirement |
| --- | --- |
| Source and metadata | All product versions move together to 8.1.0; release.json says candidate and points to these notes/checks. No protocol bump. |
| Regression | TypeScript, complete Vitest suite, full ESLint, both addon validators and metadata/locale contracts on the final candidate revision. Results belong to that revision's PR/CI. |
| CI | Require Linux quality/PostgreSQL integration/restore rehearsal and Windows installer/MSIX verification, plus Cloudflare preview. After any merge, check merged-main CI before release packaging. |
| Artifacts | Two standard addon ZIPs, ten edition ZIPs, Windows installer, unsigned local MSIX preview, current notes, SHA-256 checksums and source manifest. Verify the import controller, IPC, renderer and parser against source. |
| Live operational checks | Bounded probes cover health, companion HTML and JavaScript, leaderboards, guild directory, sign-in and unauthenticated origin rejection. Refresh the private inbox; retain unresolved historical incidents unless their live correction is established. |
| Ledger and recovery | Read-only uniqueness check during preparation. Immediately before deployment, repeat it, make fresh database/application backups, validate restore listing, and verify authenticated decryption/checksums of an encrypted off-server copy. Today's preparation cannot certify November 4 data. |
| Single bot | Record current service/process state. Deployment must use the existing lock and one pinned service; never start a second bot. Verify version, commands, assets and ledger again afterward. |
| Publication | Change candidate to release only for the chosen final source. Publish new GitHub assets and verify anonymous hashes; submit ten correct-edition CurseForge files and the reserved-identity Store package. Record pending approvals honestly. Update site/releases.json only from verified publication. |
| Installation | Store signature, submitted bytes and retained encrypted profile/account activation must be verified for the actual installed launch update. A local unsigned MSIX preview is not Store certification or installation evidence. |
| Human gameplay | Forever/Classic load/reload, two-PC sync/recovery, officer revocation, real loot exports and other-addon interaction remain NOT RUN unless a tester supplies actual evidence. The existing owner waiver is preserved. |
| Capacity | Ordinary request timing and database connections can be observed. No launch-load guarantee; no production stress test, higher-cost tier or scoring calibration is implied. |

## Candidate use and launch day

Candidate artifacts are for review/testing, not replacements for the current public release. Do not overwrite an existing version's assets or install the unsigned preview over a player's Store profile. Preserve original SavedVariables and use a disposable test setup for import/undo and recovery experiments.

Use [the launch-day test sheet](LAUNCH_DAY_TESTING_2026-11-04.md), including the new import checks. Prepare a stable candidate by November 3; accept only justified changes with fresh checks. On November 4 prioritize incoming bug reports over new features. Recheck the official opening time before publication; the project currently plans around 23:00 UTC / 6 p.m. Toronto.

## Evidence locations

Private operational receipts and local validation logs: `backups/release-candidate-8.1.0/`. Candidate PR checks and GitHub Actions artifacts provide the shareable exact-source record. The import PR's earlier 2,935 tests and green CI establish the feature baseline, not a substitute for the final candidate checks. No human gameplay pass is inferred from automated tests.

## Preparation observations — 29 October

A fresh bounded sample passed 18/18 public requests across health, companion HTML/JavaScript, leaderboards, guild directory and sign-in. Direct unauthenticated origin health returned 404. The private inbox had zero member reports and the same four historical service-error groups, with no new occurrence since October 28. Ledger event references were unique. The existing guilded service was active/running with zero service restarts and one matching tsx process; the host had 466 MiB available memory. This is ordinary-use evidence, not a database capacity or launch-load guarantee.

Fresh database/application backups passed restore-list validation. The encrypted off-server copy passed authenticated decryption and checksum comparison. Repeat these checks immediately before the November 4 deployment.

The first Windows packaging run exposed a provenance-reporting defect: Git status marked LF-generated copies dirty after a CRLF checkout although normalized content matched HEAD. The corrected check compares content against HEAD and separately includes untracked files; regression tests cover line-ending equivalence, staged/unstaged edits and ignored versus untracked files. CI now refuses genuine source drift. Use only artifacts from the final corrected revision, not the superseded first build.
