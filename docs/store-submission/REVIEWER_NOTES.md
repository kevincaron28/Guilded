# Draft Microsoft certification notes

Use only with the final package built using the reserved Partner Center identity.
The LOCAL-PREVIEW package is not a submission package.

## Purpose and capabilities

Guilded Companion is an Electron desktop utility. It reads the WoW addon
SavedVariables file selected by the user, watches for changes, and writes returned
Guilded standings into the selected addon folder. Optional PoE2 tracking reads
recognized area events from the selected Client.txt log. It does not inject into
games, automate gameplay input or require administrator privileges for normal use.

`runFullTrust` is required for the existing desktop file pickers, file watchers,
addon-file writes and notification-area operation. The package startup task is
disabled initially. The user manages startup in Windows settings. Store builds
open Microsoft Store for updates and do not download or execute GitHub installers.

## Review procedure

1. Install the final Store-identity package on a clean supported Windows x64 PC.
   Close any standalone Guilded Companion first. Launch from Start.
2. With no setup, confirm the app shows setup guidance and does not claim to be
   connected. Inspect the English and French interface and the WoW/PoE2 sections.
3. Confirm the Store update and Windows startup buttons open their respective
   Windows destinations. Startup should remain off until enabled by the user.
4. Close the window and reopen it from the notification area. Quit from the tray
   and confirm it exits. Test uninstall and reinstall using Windows Settings.
5. For connected verification, use a dedicated test Discord member/guild and
   matching Guilded addon fixtures. The reviewer must be given access through
   Partner Center's private certification notes; do not publish credentials here.
   Test sign-in, selection of a disposable saved file, sync, pause and revocation.
6. Test file access in a normal user-writable WoW addon folder. If a folder denies
   writes, the app should report it rather than requiring a privilege bypass.

No review account, game login, identity document or secret is included in this kit.
The 7.5.0 local preview installed, launched with protected configuration and
uninstalled successfully. WACK completed with overall WARNING: 22 passes, an
optional blocked-executables failure and a DPI inspector warning. See
`LOCAL_VALIDATION_2026-10-26.md` for evidence and limitations. The temporary preview
certificate trust and private key were removed. Store-signed installation/upgrade
and connected acceptance remain pending.

## Screenshot capture plan

Capture the final installed app with a clean test profile, never personal pairing
credentials or guild records. Required candidates: first-run overview, WoW setup,
connection profiles, optional PoE2 setup. Capture English and French as appropriate.
Use genuine app screenshots; label any sample guild data as demonstration data.
Do not substitute web-companion screenshots for the native Store edition.
Eight genuine 7.5.0 installed-preview screenshots were captured in English/French.
They show the actual packaged app with a clean unlinked profile, not a Microsoft
Store-signed installation. Check the handoff for their current upload state.

## Product declarations completed in the actual form

Partner Center Properties and Age ratings are Complete. IARC was saved after the
owner explicitly authorized disclosure and accepted the agreement. Exact answers,
rating results and rationale are recorded in `iarc-questionnaire.json`; the rating
ID currently displays Pending. The app remains an uncertified draft submission.
The listing is free; optional website donations do not unlock app features. The
project license remains unchanged.
