# Guilded 8.0.2 publication evidence — 28 October 2026

The final 8.0.1 audit identified two P2 findings: an unbounded participation
status ledger read and spreadsheet exports that could interpret user text as a
formula. PRs [#256](https://github.com/kevincaron28/Guilded/pull/256) and
[#257](https://github.com/kevincaron28/Guilded/pull/257) fix these in a deliberate
8.0.2 release. All agreed 8.0 features, complete FR/DE/ES addon catalogues, protocol
2, existing data and frozen policies are retained. Published 8.0/8.0.1 bytes remain
available. See [the feature audit](FINAL_8_0_1_AUDIT_2026-10-28.md).

## Reviewed source and public GitHub downloads

Client/tag and running bot source: `f7ca4c49f83912e3bd88a2f66e7fd04b73e6748d`.
Local release preparation passed **341 files / 2,859 tests**, TypeScript, ESLint,
both addon validators, both zero-vulnerability audits, browser/site builds and
Windows installer/source verification. PR CI `40778430768` and exact-main CI
`40779058310` passed Linux/PostgreSQL integration-and-restore and Windows packaging.

Root and ten edition ZIPs were rebuilt on clean merged main. Source verification
and edition manifests record that commit and no local source changes. The new
[GitHub 8.0.2 release](https://github.com/kevincaron28/Guilded/releases/tag/v8.0.2)
has 21 assets; all anonymous HTTPS downloads match their SHA-256 and size, and the
tag resolves to the reviewed source. Receipts: `backups/release-8.0.2/` (private).

## Single production deployment and recovery

At 22:27 UTC, Oracle's existing bot service activated the exact reviewed source
after fresh unique-ledger preflight, verified PostgreSQL/application recovery
backup and authenticated decryption/checksums of its encrypted off-server copy.
The post-update ledger check and command-registration health passed. The previous
application is retained for rollback without overwriting newer database writes.
No second bot was started, and no schema, hosting plan or scoring policy changed.

A read-only production query sampled an existing active season and user. The new
summary's score matches an independent aggregate, and its helper result limit is
respected. No test awards or Discord mutations were made. This correction does
not establish the cause of the earlier Aiven maintenance-associated warning.

## Microsoft Store

Validated submission package: `Guilded.Companion.8.0.2.x64.STORE-SUBMISSION.msix`,
165,367,453 bytes, SHA-256
`ad8699bae818a0efadf92b32dfec945fc7dd76fad6a767e422572728e8a281d8`.
Reserved identity, version 8.0.2.0 and packaged application sources were verified.
Submission 4 (`1152921505702260716`) contains the actual package and saved EN/FR
patch notes. Microsoft confirms certification and publication completed. The
read-only published package page shows 8.0.2.0, X64.

The actual Store upgrade to **8.0.2.0** is installed on this PC. The Microsoft
Store CLI applied it by product name. Windows reports Store signing and status OK;
the PKCS#7 signature and certificate chain verify, and installed `app.asar` matches
the submitted application byte for byte. Native packaged activation displays
**Version 8.0.2**, the Store distribution/update/startup controls and the saved
account connection. Tracking remains paused with game files unset; a live sync is
not claimed.

An initial comparison against the earlier 430-byte encrypted profile differed.
Investigation found the current 558-byte file was written at 22:49:39 UTC, before
the new package directory was created at 22:54:52 UTC. The file is unchanged across
8.0.2 activation, and the application reads its saved account connection. This
establishes retention/readability of the existing profile; it does not establish
bitwise equality to the older baseline or the cause of that earlier rewrite.
No profile was reset, no credentials were entered by this audit, and existing
standalone profiles and SavedVariables were retained.

The owner's baseline Store controls and French Setup/Help checks remain recorded.
Retain the free Store method and PolyForm Noncommercial license. The optional
GitHub EXE is unsigned; Store certification does not sign that separate installer.

## CurseForge edition submissions

All ten matching Release files are approved and published. Their anonymous CDN
downloads match the GitHub release sizes and SHA-256 hashes. Each file has the
correct edition tag below. Provider metadata now records those exact verified
files. Earlier files remain available. Both public EN/FR descriptions identify
8.0.2 and the retained feature/language coverage, typed sign-in and Store link.

| Edition | Game tag | Guilded file | Guilded Dungeons file |
| --- | --- | --- | --- |
| Forever | 1.60.1 | 9357269 | 9357283 |
| Era / Hardcore | 1.15.9 | 9357273 | 9357289 |
| Burning Crusade | 2.5.6 | 9357280 | 9357298 |
| Mists | 5.5.4 | 9357287 | 9357305 |
| Retail | 12.1.5 | 9357291 | 9357310 |

## Operational observations

After the 8.0.2 update, the service is active with commands OK and no warning-level
journal entries since activation. The refreshed private bug inbox has zero open
member reports and four retained historical service-error groups; none was
automatically marked resolved.

At 22:33 UTC, a bounded read-only Aiven snapshot found six other idle client
connections, no active/idle-in-transaction clients or lock waiters, zero recorded
deadlocks/temp files, a 19.2 MiB application database and the existing pool maximum
of five. Aiven's one-hour graphs show roughly 27% memory available, 72–73% used and
20% CPU, with a stable trend across this deployment. These are visual estimates,
not exported metric samples. The earlier maintenance-associated alert's cause is
still unconfirmed. Ordinary current activity does not prove launch-load capacity;
no load stress, paid-plan change, database setting change or data deletion was made.

GitHub-only metadata and guide corrections merged in PR #258 (`52daf36`), whose
PR CI `40781208219` and exact-main CI `40781665889` passed both required jobs.
English/French edition pages show the 8.0.2 downloads and preserve the selected
edition/language. Quick-start instructions now describe the typed confirmation
code. Launch-post text remains an owner-reviewed draft; no outreach was sent.

## Acceptance limits

No other missing implementation was identified in the agreed launch scope.
Verified Forever API/encounter/loot data and representative live calibration
require the game; unsupported routes remain unrated and benchmarks provisional.
The owner's earlier manual-testing waiver remains explicit. Unperformed gameplay,
two-PC, native accessibility, live member/officer and arbitrary private GRM archive
checks are not reported as passes or reclassified as game-release dependencies.
Language review is model-assisted, without independent native-speaker certification.
Bug reports remain available for post-release defects; no zero-bug guarantee is made.
