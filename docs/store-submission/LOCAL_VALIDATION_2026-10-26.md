# Installed MSIX validation — 26 October 2026

Tested the 7.5.0 local preview, using the same app payload as the uploaded Store
candidate but a separate preview identity. This is not Microsoft certification.

## Completed

- Installation, packaged activation and protected configuration creation succeeded.
- Captured eight genuine native screenshots (overview, WoW, PoE2 and settings,
  English/French) through the explicitly approved built-in screenshot diagnostic.
  Clean unlinked profile; no personal guild records or pairing secrets.
- WACK 10.0.26100.9457 completed a full run on Windows 10 Pro build 19045 at
  12:19:55 Toronto. Exit code 0; **overall WARNING**, not a clean pass.
- 22 tests passed; one optional test failed; one required test returned WARNING.
- Cleanup verified: preview uninstalled, exact TrustedPeople certificate removed,
  and private preview certificate/key removed. No cleanup errors.

## WACK findings

**Blocked executables (optional): FAIL.** The scanner found CreateProcessW and
string matches in Electron/Chromium binaries, resources and app.asar. Review of
the app's process-launch path confirms the standalone updater is behind the
Store-package early return; Store builds open Microsoft Store updates instead.
No application calls to cmd.exe, reg.exe or PowerShell were found. Electron uses
child processes for its runtime. This is source review, not an S-mode runtime test.
Microsoft documents [Desktop Bridge optional tests](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests)
as informational for onboarding; retain the finding for reviewer transparency.

**DPIAwarenessValidation (required): WARNING.** WACK reported an inspection error
processing the executable. Its detailed trace detected SetProcessDpiAwarenessContext,
then raised COM E_FAIL in IsPerMonitorV2DPIAwarenessSet. SDK mt.exe successfully
extracted the executable manifest: dpiAware is `true/pm`, execution level is
`asInvoker`. This supports an inspector failure rather than absent DPI metadata;
multi-monitor scaling acceptance and Microsoft's own assessment remain pending.

## Evidence retained locally

Ignored directory `backups/msix-install-review/` contains `install-result.json`,
`wack-report.xml`, `wack-test.log`, `wack-result.json`, `cleanup-result.json`,
`electron-executable.manifest` and `screenshots/*.png`. The package hashes are in
the main Store handoff. Never upload the signed LOCAL-TEST package or test key.

## Remaining acceptance

Store-signed install/update, tray/startup destinations, real Discord sign-in and
game tests are not inferred from these checks.

## Follow-up: French labels and isolated reviewer sandbox

French connection-profile labels and fallback name translation are fixed. Authored
profile/guild names remain untouched. Preview, Store and standalone builds were
regenerated. The WACK report above covers the preceding preview payload, not this
rebuilt payload; it remains WARNING and must not be described as final certification.
Replace the old Store upload and the French settings screenshot before submission.

An isolated Cloudflare Worker has no production database, Discord token or external
service binding. It accepts only the supplied synthetic export, stores a session
hash/expiry/import flag and bounded rate counter, and expires 25 November 2026 UTC.
On 26 October its public HTTPS endpoint passed nine checks using the actual
companion parser, pairing, engine and standings writer. This proves the synthetic
connection path, not live Discord OAuth, PoE2 or game compatibility. Evidence:
`backups/store-review-smoke/result.json`. No credential is included in this record.
