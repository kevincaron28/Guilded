# Guilded 8.0.1 launch completion — 28 October 2026

The owner requested completion of non-game launch work and explicitly chose full
German/Spanish addon translations. They approved installing the free Store package
under its Microsoft agreements. Their earlier decision to retain the license and
use Microsoft Store signing remains in force. 8.0.1 is a new launch patch;
published 8.0 bytes are retained.

## Implementation and language review

All 1,052 catalogue keys have French, German and Spanish values. The pass reviewed
the existing 149 German/Spanish entries, added 861 missing reference entries and
42 additional authored UI strings, corrected French accents and “Main” in the
raid-roster context, and shortened two Spanish controls caught by window tests.
English remains the key/fallback; source protocol and user-entered data are not
translated. Command tokens and IMPORT/UNDO IMPORT confirmation phrases remain
unchanged. Padded timers, percentages, interpolation order, named fields and links
have regression coverage. Both addons receive the same generated locale file.

The review is model-assisted linguistic work plus automated/offline layout checks,
not an external native-speaker certification. Companion/bot/site support remains
English/French; addon language coverage does not imply extra supported languages
on those products. See [translation maintenance](TRANSLATING.md).

## Windows signing and installation

The Microsoft Store installed `Kcaron.GuildedCompanion` 8.0.0.0 on this PC.
Windows reports `SignatureKind: Store`, `Status: Ok`; the Appx PKCS#7 signature
and certificate chain verify cryptographically. Packaged activation opened the
companion's real Setup screen with version 8.0.0. Its separate Store profile was
created with encrypted `config.secure`. No credentials were entered or copied.

Initial inspection of Setup did not display controls that actually belong to
Overview. That was an observation error, not a confirmed distribution-detection
bug; the proposed fallback change was removed. Desktop capture/input did not work,
so the owner was asked to verify Overview's Store updates/startup buttons and
French Setup/Help. Those requested results are not yet recorded passes.

The Store method is free and already published. SignPath requires an OSI-approved
license, incompatible with the retained PolyForm Noncommercial license. No
relicensing or paid subscription is authorized. The optional GitHub EXE is still
unsigned; it must never be described as Store-signed.

Private receipts and review catalogue: `backups/launch-completion-2026-10-28/`.

Local checks passed: **340 files / 2,856 tests**, TypeScript, ESLint, both addon
validators, ten edition packages, Windows NSIS build and Store MSIX source/identity
verification. The final review CSV has 1,052 rows in each translated language.
Exact-source CI and provider publication remain separate gates below.

## Required release verification

- Full TypeScript, Vitest, ESLint and both addon validators; complete language
  catalogue, interpolation and German/Spanish offline button checks.
- Linux PostgreSQL/restore and Windows installer/MSIX CI on the exact source.
- New 8.0.1 addon packages, companion and Store submission verified against source;
  preserve all 8.0 assets and installed user data.
- Fresh ledger/database/application/off-server backups before the single bot update.
- Public health/commands/origin and byte-identical online-companion checks after deploy.
- GitHub publication/download hashes, all edition-specific CurseForge approvals,
  Store certification and installed Store update verified separately.

## Remaining evidence to reconcile

The previous audit's waived non-game checks (Windows install/update, native
accessibility, fresh member/officer browser flows and supported GRM archives) are
being revisited in this completion pass. Do not silently reclassify them as
requiring Forever's release. Current supported GRM formats and permission checks
are the compatibility contract; arbitrary unknown exports are not assumed supported.
Forever API/encounter/loot data, live dungeon calibration and gameplay/two-PC
acceptance remain separate unavailable-game work.
