# Publishing Guilded 6.0.0 Release

Use [CURSEFORGE_COPYPASTE.md](CURSEFORGE_COPYPASTE.md) for the current description
and changelog. The owner promoted 6.0.0 to full Release on 5 October 2026.
Unverified checks remain follow-up work. Do not create another 6.0 Beta or bump
to 6.1 incidentally. The listing must state that KCaron's approval is required
before the hosted bot works in each Discord server.

## Setup-only refresh, 9 October 2026

Main contains the private [officer bridge](OFFICER_COMPANION_BRIDGE.md), reserved
for 6.1 pending two-player acceptance. Do not publish that game code as a routine
6.0 documentation refresh. Start with the verified published addon ZIP from
source `9fd70626b1800eaf26fb0f363144f81753c91d21` and update only
`Guilded/INSTALL.md`. Verify every other archive entry is byte-identical.

Use the distinct filename `Guilded-v6.0.0-hosted-pilot.zip` and display name
**Guilded 6.0.0 - Hosted pilot setup**, type **Release**, existing verified
**Forever / 1.60.1** compatibility. Keep the original release/source available.
Attach the refreshed SHA-256 manifest. No gameplay change or new version is implied.

## Prepare matching downloads

Run `npm run release:prepare` on Windows and verify final-commit PostgreSQL and
Windows CI. Preserve release evidence and checksums. The release set is:

- `dist/Guilded-v6.0.0.zip` — addon, including the current `Guilded/INSTALL.md`.
- `dist/companion/Guilded Companion Setup 6.0.0.exe` — desktop companion.
- Source for the **same reviewed commit**, for independent guild owners.
- Release notes, known limitations and the [hosted pilot guide](HOSTED_PILOT.md).

Do not upload the whole `dist` folder: it may contain older versions and test
patch ZIPs. A generated ZIP, local installer or passing unit suite is not proof
that publication, clean installation or live acceptance succeeded.

## CurseForge listing

Use the existing Guilded project and the current copy-paste sheet. Upload only
the addon ZIP; its top-level folder must be `Guilded`. Set display name
**Guilded 6.0.0**, release type **Release**, and only verified client compatibility.
Do not select a merely similar client version to get past a missing listing.
The declared interface numbers are 16001 and 20506; they do not prove every
client with those numbers was tested.

The custom license is **PolyForm Noncommercial 1.0.0**; use the full repository
LICENSE text. Branding files live under `docs/branding/`. Use current in-game
screenshots showing the release candidate; Raid tools were removed from v6.

## GitHub and setup links

Publish the matching Windows companion and source reference alongside the addon
and release notes. The bot and companion are not included in the CurseForge addon.
Link [HOSTED_PILOT.md](HOSTED_PILOT.md) prominently: users can invite the hosted
bot, but must wait for KCaron's approval before setup. Support is optional;
link [SUPPORT_GUILDED.md](SUPPORT_GUILDED.md), never an invented payment URL or
the owner's private PayPal email. Donations never buy admission or priority.
Link [MEMBER_INSTALL.md](MEMBER_INSTALL.md) for members and
[GUILD_OWNER_SETUP.md](GUILD_OWNER_SETUP.md) for owners. Prefer links pinned to
the published release tag/commit so the guide agrees with the download.

After publication, download the actual public files and compare checksums with
the approved artifacts. Verify that a signed-out visitor can find the addon,
companion, matching bot source and instructions from the listing. Record the
actual URLs and publication status in the release testing record. Do not promise
30-minute cloud provisioning; the quick guide states the required infrastructure.
