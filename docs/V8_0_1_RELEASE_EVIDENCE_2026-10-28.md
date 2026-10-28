# Guilded 8.0.1 publication evidence — 28 October 2026

8.0.1 completes the 8.0 launch-language work without replacing published 8.0
assets. Protocol remains 2. [PR #253](https://github.com/kevincaron28/Guilded/pull/253)
merged as `cdc1a51685256afb5a0612d76e005f94e29a8147` after Linux/PostgreSQL/restore
and Windows packaging CI `40763931456` passed. Exact-main CI `40764615872` passed.

## Source, packages and languages

Local validation passed **340 files / 2,856 tests**, TypeScript, ESLint and both
addon validators. The ten edition ZIPs and root addon ZIPs were rebuilt from clean
main, and their source verifier passed. Windows installer and reserved-identity
Store MSIX builds passed package/source verification. Every catalogue contains
1,052 French, German and Spanish translations, with ordered formatting, actual
Lua and offline window checks. See [launch completion](V8_0_1_LAUNCH_COMPLETION.md)
for the linguistic review's scope and limits.

The [GitHub 8.0.1 release](https://github.com/kevincaron28/Guilded/releases/tag/v8.0.1)
is published with 21 assets. All 21 anonymous HTTPS downloads match the recorded
SHA-256 and size; the tag resolves to the reviewed source above. Earlier release
bytes are retained. Publication and download receipts are kept privately in
`backups/launch-completion-2026-10-28/`.

## Windows trust and owner checks

The actual free Microsoft Store 8.0.0.0 baseline was installed and activated on
this PC. Windows reports `SignatureKind: Store`, `Status: Ok`; its package PKCS#7
signature and certificate chain verify cryptographically. The owner confirmed
Overview shows “Microsoft Store installation”, “Store updates” and “Startup
settings”, Store updates opens Microsoft Store, and French Setup/Help work.
The separate Store profile contains encrypted `config.secure`; no pairing
credentials were copied or entered during these checks.

8.0.1 MSIX: `Guilded.Companion.8.0.1.x64.STORE-SUBMISSION.msix`, 165,367,448 bytes,
SHA-256 `c119293f7dd83105f4b7dde930059b0648ad9431c3fc1baf63d14ec1066519e5`.
Submission 3 (`1152921505702259238`) contains this validated 8.0.1.0 x64 package
and saved EN/FR maintenance notes. It was submitted for certification with
automatic publication. Microsoft confirms certification and publication completed;
the read-only published package page shows 8.0.1.0, X64.

The actual Store upgrade to **8.0.1.0** is installed on this PC. WinGet initially
reported no available upgrade; the installed Microsoft Store CLI found it by name
and applied it with `store update "Guilded Companion" --apply true`. Windows reports
Store signing and status OK. The package signature and certificate chain passed
cryptographic validation; the installed `app.asar` matches the submitted build
byte for byte. The encrypted Store profile is unchanged from its pre-update hash.
Packaged activation opened the actual Setup window showing **Version 8.0.1**.
The original standalone profile and all SavedVariables were retained.

The retained PolyForm Noncommercial license and free Store signing decision
remain unchanged. The optional standalone GitHub EXE is unsigned.

## CurseForge edition files

Both public descriptions were updated from stale 7.3.2 text to 8.0.1, with accurate
addon-only DE/ES coverage, optional typed-code sign-in and the signed Store link.
Canonical text: [Guilded](curseforge/GUILDED_DESCRIPTION.md) and
[Guilded Dungeons](curseforge/DUNGEONS_DESCRIPTION.md).

All ten actual edition ZIPs are approved Release files, with automatic publication.
Their anonymous CDN downloads were rechecked after approval and match the
published GitHub hashes and sizes. `site/releases.json` records each exact
approved edition file alongside the separately verified Store 8.0.1.0 version.

| Edition | Game tag | Guilded file | Guilded Dungeons file |
| --- | --- | --- | --- |
| Forever | 1.60.1 | 9356457 | 9356498 |
| Era / Hardcore | 1.15.9 | 9356467 | 9356503 |
| Burning Crusade | 2.5.6 | 9356471 | 9356513 |
| Mists | 5.5.4 | 9356476 | 9356517 |
| Retail | 12.1.5 | 9356480 | 9356520 |

## Production and remaining evidence

Oracle's single bot service deployed exact source
`cdc1a51685256afb5a0612d76e005f94e29a8147` after exact-main CI, a fresh ledger
preflight, verified database/application backup and authenticated encrypted
off-server recovery. The prior application remains available for rollback without
restoring over newer database writes. The post-update ledger check passed.
Public health reports **8.0.1 / protocol 2 / commands ok**. Public companion access
works, and untrusted direct-origin health, companion and standings probes return
404. The fresh private bug inbox has zero open member reports and four retained
historical service-error groups; this release does not mark them resolved.
The served browser companion bundle matches the local reviewed build byte for
byte. PR #254 (`f785c6f`) and exact-main CI `40769299562` passed for the GitHub
metadata and publication records; all 11 public edition/navigation/sign-in and
runtime checks passed after automatic website deployment. Final approved
provider links use the same CI/merge and public-check gates, independently of
the already successful application update.

No missing implementation was identified in the agreed 8.0 feature inventory.
Forever API/encounter/loot data and representative gameplay/score calibration
remain game-dependent. The earlier manual testing waiver is preserved; unavailable
native/accessibility or private archive checks are not represented as passed or
as game-release dependencies. See the precise limits in the completion record.
