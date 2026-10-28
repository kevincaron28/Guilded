# Microsoft Store update — Guilded Companion 8.0

Status: Partner Center Submission 2 (`1152921505702255246`) published 28 October 2026.
Partner Center confirms “Your latest product is now available on Microsoft Store.”
Its published package details show the verified 8.0.0.0 x64 MSIX, with saved EN/FR
notes. Existing listing properties and private reviewer instructions were retained.
The desktop app's in-app browser completed the file chooser upload; the Chrome
chooser timeout did not affect that upload. Publication and package identity were
read back in Partner Center. No new installed Store-client acceptance is claimed;
the owner waived remaining hands-on install/upgrade checks.
See [release evidence](../V8_0_RELEASE_EVIDENCE_2026-10-28.md) for package SHA-256.
Public listing verified 28 October 2026:
[Guilded Companion](https://apps.microsoft.com/detail/9N680XX3QFL9), publisher Kcaron.
Keep the existing reserved identity in `publisher-identity.json`; this is an update to
the same product, not a new listing. Target launch: 4 November 2026.

## What's new — English draft

Guilded Companion 8.0 improves connection security and reliability. Discord sign-in asks
you to enter the code displayed in your companion. Saved Windows credentials are protected,
and removing local data attempts to revoke saved online connections. Oversized addon data
is rejected with clear guidance to preserve your original file. Includes English/French
setup improvements and support for separate profiles across supported WoW editions.

## Nouveautés — brouillon français

Guilded Companion 8.0 améliore la sécurité et la fiabilité des connexions. La connexion
Discord vous demande de saisir le code affiché dans votre compagnon. Les identifiants
Windows enregistrés sont protégés et la suppression des données locales tente de révoquer
les connexions en ligne. Les données d'addon trop volumineuses sont refusées avec des
consignes pour conserver le fichier original. Améliorations de configuration en français
et en anglais, avec des profils distincts pour les éditions WoW prises en charge.

## Submission gates

1. Finish the 8.0 scope and record the owner's remaining manual acceptance waiver in
   `../V8_0_LAUNCH_READINESS.md`; reconcile these notes with the final implemented behavior.
2. Deliberately bump the shared product version to 8.0.0 only at the release step.
   Build the Store package with the existing identity; verify the exact MSIX manifest,
   increasing package version, bundled source, license and restricted capabilities.
3. Keep the preceding WACK warnings disclosed. Remaining hands-on install/upgrade checks
   were waived by the owner; they are not passed results. Run available package verification.
   Confirm Store updates, startup settings, encrypted profile preservation and browser
   sign-in; ensure only one companion is running. Keep existing warnings visible.
4. Update this product's Partner Center submission with the final MSIX, EN/FR notes and
   current sanitized screenshots. Review privacy/support links and reviewer instructions.
   Submit the final tested update and verify Microsoft's resulting state.
5. After approval, verify the public listing and actual installed Store version. Update
   published provider metadata only with that evidence. GitHub publication is a separate
   event; do not label the Store download 8.0 while it still delivers an earlier version.

Microsoft controls certification timing. The existing listing remains the stable link
through the update. The GitHub EXE is not made Authenticode-signed by Store certification.

## Download-link coverage

Use the public listing above on the website's download/setup section, README, member and
quick-start guides, companion Help & privacy, Discord help and final 8.0 release notes.
Keep a standalone GitHub alternative. Do not force Store users onto the EXE updater.
