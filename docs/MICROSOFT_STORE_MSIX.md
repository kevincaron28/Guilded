# Guilded Companion — Microsoft Store preparation

Owner decision, 26 October 2026: retain PolyForm Noncommercial 1.0.0 and prepare
Microsoft Store distribution. No SignPath enrollment or relicensing is planned.

## What is prepared

The existing NSIS installer stays the default. MSIX builds use separate output
folders, an explicit Store identity and the same companion/engine sources. They
include the Guilded license, branded tiles and English/French resources. The only
restricted capability is `runFullTrust`, required by the Electron desktop app.

Packaged installations use Microsoft Store updates. They never fetch or launch
the GitHub EXE updater. Startup is an initially disabled package startup task,
managed by the user in Windows settings; the app does not create a registry Run
entry for a Store installation. The app still works in the tray after launch.

Store profiles use a separate application-data folder and Windows-backed
`safeStorage` encryption for configuration, including credentials in all profiles.
They do not import standalone/CLI credentials automatically. Unavailable protection
or decryption errors fail visibly rather than falling back to plaintext or
overwriting unreadable settings. Actual Electron/Windows encryption round-trip
verification passed using synthetic credentials, without a game or network.

## Local preview

From the repository root:

```powershell
npm --prefix companion-app run msix:preview
node scripts/verify-msix.mjs dist/msix-preview/Guilded.Companion.7.4.0.x64.LOCAL-PREVIEW.msix
```

The filename follows the current companion version. `LOCAL-PREVIEW` uses a
deliberately fictitious identity, is unsigned, and must not be uploaded or
distributed as a public installer. Verification inspects the package manifest,
tiles, license and actual ASAR source bytes. It does not install the app, create
a trusted certificate, or claim Store certification. No Windows trust settings
are changed by either command.

## Submission build

Reserve the product in Microsoft Partner Center. Copy the exact, case-sensitive
values from **Product management → Product identity** into a local JSON file:

```json
{
  "name": "EXACT Package/Identity/Name FROM PARTNER CENTER",
  "publisher": "EXACT Package/Identity/Publisher FROM PARTNER CENTER",
  "publisherDisplayName": "EXACT Package/Properties/PublisherDisplayName"
}
```

Those example strings are instructions, not usable identity values. Build with:

```powershell
npm --prefix companion-app run msix:store -- --identity "C:\path\store-identity.json"
```

The output is `dist/msix-store/…STORE-SUBMISSION.msix`. Inspect it with
`scripts/verify-msix.mjs` before submission. This command does not upload anything.
Store signing occurs only after Microsoft accepts and certifies the submission;
the GitHub EXE remains independently unsigned.

## Draft listing

Name: Guilded Companion. Category proposal: Utilities & tools. Languages: English,
French. Architecture: x64. Minimum Windows version: Windows 10 version 2004.

English short description: Connect your Guilded addon and Discord guild across
WoW editions, and record your Path of Exile 2 mapping sessions.

French short description: Reliez votre addon Guilded et votre guilde Discord
sur plusieurs éditions de WoW, et suivez vos sessions de cartes Path of Exile 2.

Capability explanation for reviewers: The desktop companion reads user-selected
WoW SavedVariables and optional PoE Client.txt files, watches for changes, and
writes Guilded standings into the selected WoW addon directory. It uploads data
only after the user configures a connection and enables the relevant game.
Full-trust desktop access supports those existing file pickers/watchers and
the notification-area window. It does not automate game input or inject into games.

## Still required

The owner subsequently requested progressing toward Store approval while away.
On 26 October Microsoft sign-in succeeded. The developer portal is now at
**Choose account type**, with identity verification, profile details and account
setup incomplete. The onboarding page is left open for the owner to complete
directly with Microsoft. No developer account was enrolled and no package submitted.

Run `node scripts/prepare-msix-submission-kit.mjs` from the repository root to
assemble `dist/msix-submission-kit/`. It includes the verified preview separately
marked **not for upload**, EN/FR listing drafts, reviewer notes, the prepared privacy notice,
an empty identity template and a readiness manifest. The actual submission build
still requires the reserved identity. Do not use a fictitious publisher or claim
that local validation is Microsoft certification.

The owner selected the existing Discord support community for privacy requests.
The full bilingual notice is prepared in `docs/PRIVACY.md`, built at
`/docs/PRIVACY.html` and linked from companion Help & privacy. The public URL must
be deployed and verified before it is used in a submission.

- Owner's Partner Center identity and account enrollment.
- Store listing privacy/support links, screenshots, age/content declarations,
  and review of the draft above against the final packaged behavior.
- Windows App Certification Kit and a real packaged install/uninstall/upgrade
  check, including file access, tray behavior, startup settings and Discord sign-in.
- Close the prior standalone companion before testing the Store copy. Verify
  profile/data behavior rather than assuming its Windows package data matches
  the standalone installation; do not copy credentials automatically.
- Microsoft review of `runFullTrust`, certification and publication.

Sources checked 26 October 2026:
[Store distribution/signing](https://learn.microsoft.com/en-us/windows/apps/publish/get-started),
[MSIX requirements and identity](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements),
[Electron package detection](https://www.electronjs.org/docs/latest/api/process#processwindowsstore-readonly),
[Store update URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-store-app).
