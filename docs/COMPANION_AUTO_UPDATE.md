# Companion automatic updates (direct download)

Two ways to install the Windows companion, and exactly one of them updates itself:

| Install | Who updates it |
|---|---|
| Microsoft Store (MSIX) | The Store. The app never replaces itself (`process.windowsStore`, or a path under `WindowsApps`). |
| Direct download (NSIS `.exe`) | The app itself, quietly, from GitHub Releases. |

## How the direct build updates

Logic lives in `companion-app/update-check.cjs`; wiring in `companion-app/main.cjs`.

1. 20 seconds after start, then every 4 hours, it reads `releases/latest` of `kevincaron28/Guilded` (stable only; offline or rate-limited answers keep the last known state and retry at the next check).
2. A newer release whose `Guilded.Companion.Setup.X.Y.Z.exe` asset carries GitHub's `sha256:` digest is downloaded in the background to `%APPDATA%\Guilded Companion\updates\`. Size and SHA-256 are checked before the file is kept.
3. It installs silently (`/S --updated`) when the member quits the companion, or at the next start (then the new version restarts). The checksum is verified again just before running it; a mismatch, a stale file, a wrong folder or two failed attempts discards the download.
4. After an update the app shows "Updated to vX" once. No notification is shown for the update itself.
5. Settings → "Install updates automatically" turns it off; "Check for updates" checks now. "Update now" in the Overview banner still works.

The development checkout (`app.isPackaged` false) and non-Windows platforms never self-update.

## Why not electron-updater

electron-updater needs `latest.yml` and a blockmap on every release and verifies SHA-512 from that file. The existing updater already verifies SHA-256 against GitHub's own asset digest and shipped in 7.2. Extending it needs no new release files other than the fixed-name copy below.

## Stable download link

`https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe`

This only works if every release carries an asset with that exact name. `scripts/verify-release-artifacts.mjs` adds it (same bytes as `Guilded.Companion.Setup.X.Y.Z.exe`) to the artifact list and to `SHA256SUMS`, so a publish script that uploads the manifest's artifacts uploads it too.

## What each release must do

1. Run `npm run release:prepare` / `verify-release-artifacts.mjs` as before; the manifest now lists `Guilded.Companion.Setup.exe` as well. Upload every artifact in the manifest (the per-release `publish-release.mjs` asserts the asset count equals the manifest, so nothing else to change).
2. Update `site/releases.json` → `guilded.companionDirect.version` and `.sha256` (the SHA-256 of the installer, shown on `/companion/`).
3. Never publish a release as a pre-release or leave it a draft if members should receive it: the updater only reads the latest stable release.
4. The first release that includes the fixed-name asset is the one that makes the stable link work. Until then the link returns 404 (8.4.6 does not have it).

## Getting existing 8.4.6 direct installs onto auto-updates

8.4.6 and earlier only update when the member presses "Update now". They need one last manual update to the first release that contains this updater; from then on it is automatic.
