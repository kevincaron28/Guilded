# Guilded 7.3.1 Release

22 October 2026. Bot, Guilded, Guilded Dungeons and companion packages share
version 7.3.1; protocol remains 2.

## Clearer raid readiness

Raid reports now require level 60 before a character can count as gear ready.
Levelling characters have their own section with their level and remaining levels;
ordinary levelling gaps no longer appear as raid gear failures. Reports show when
gear was checked, flag checks older than 24 hours, and consolidate members without
uploaded checks. Missing levels or incomplete checks never count as ready.

Use `/lead readiness-raid` for the full private report. Gear readiness is separate
from attunements (checked when a target is selected) and fresh consumable scans.

## Companion Update now repair

The companion now keeps installer details when they arrive after the bot announces
the same version, and retries the release lookup when Update now is clicked.
Opening a download page no longer leaves the button stuck on Installing.
Windows launch failures are caught and shown so the update can be retried; update
stages appear in Activity. Installer size and SHA-256 checks remain required.

For companions still on 7.2.0 or 7.3.0, the old updater may need this one-time
manual upgrade: download and run the 7.3.1 installer. Existing settings and pairing
are preserved. The repaired update flow is included in 7.3.1 for future updates.

## Other changes already merged into main

Members can link characters through `/guilded verify` without running their own
companion, when an officer with the matching addon and companion relays the data.
Guildless characters get an explanation and nothing is linked. Setup warns officers
when no officer companion has synced recently. Game-event boards remain opt-in.

## Deployment and verification

Follow the normal PostgreSQL backup, encrypted offsite copy, ledger preflight,
CI/restore and single-service deployment gates. Main includes additive migration
`20261123090000_character_verify`; preserve game SavedVariables and companion data.
This release does not enable event boards, change seasons or recalculate points.

Regression tests cover raid eligibility, old checks, bot-first update discovery,
download-page fallback, failed installer launch and retry. Final-commit quality,
PostgreSQL restore and Windows packaging checks are required. The Windows installer
is unsigned. A real update from this fixed version to a future release and existing
uncompleted game checks remain acceptance follow-up; do not record them as passed.
