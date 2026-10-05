# Publishing Guilded 6.0.0 Beta

Use [CURSEFORGE_COPYPASTE.md](CURSEFORGE_COPYPASTE.md) for the current description
and changelog. This is a testing Beta. Promotion to Release requires the remaining
[V6_0_RELEASE_TESTING.md](V6_0_RELEASE_TESTING.md) checks, including a real raid;
it does not happen automatically after a day.

## Prepare matching downloads

Run `npm run release:prepare` on Windows and verify final-commit PostgreSQL and
Windows CI. Preserve release evidence and checksums. The release set is:

- `dist/Guilded-v6.0.0.zip` — addon, including the current `Guilded/INSTALL.md`.
- `dist/companion/Guilded Companion Setup 6.0.0.exe` — desktop companion.
- Source for the **same reviewed commit**, for independent guild owners.
- Beta notes, known limitations and the [quick setup guide](QUICK_START.md).

Do not upload the whole `dist` folder: it may contain older versions and test
patch ZIPs. A generated ZIP, local installer or passing unit suite is not proof
that publication, clean installation or live acceptance succeeded.

## CurseForge listing

Use the existing Guilded project and the current copy-paste sheet. Upload only
the addon ZIP; its top-level folder must be `Guilded`. Set display name
**Guilded 6.0.0 Beta**, release type **Beta**, and only verified client compatibility.
Do not select a merely similar client version to get past a missing listing.
The declared interface numbers are 16001 and 20506; they do not prove every
client with those numbers was tested.

The custom license is **PolyForm Noncommercial 1.0.0**; use the full repository
LICENSE text. Branding files live under `docs/branding/`. Use current in-game
screenshots showing the release candidate; Raid tools were removed from v6.

## GitHub and setup links

Publish the matching Windows companion and source reference alongside the addon
and beta notes. The bot and companion are not included in the CurseForge addon.
Link [MEMBER_INSTALL.md](MEMBER_INSTALL.md) for members and
[GUILD_OWNER_SETUP.md](GUILD_OWNER_SETUP.md) for owners. Prefer links pinned to
the published release tag/commit so the guide agrees with the download.

After publication, download the actual public files and compare checksums with
the approved artifacts. Verify that a signed-out visitor can find the addon,
companion, matching bot source and instructions from the listing. Record the
actual URLs and publication status in the release testing record. Do not promise
30-minute cloud provisioning; the quick guide states the required infrastructure.
