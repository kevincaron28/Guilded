# Raid tools extraction — 4 October 2026

Removed from Guilded's v6 release scope at the owner's request. This directory
preserves the former module, UI, French translations and tests for a future
optional standalone leader addon. It is outside the Guilded ZIP's source tree.
This is development reference material, not an installable standalone addon.

The archived code still depends on Guilded's namespace: settings/database,
translations, compatibility helpers, paced communication, identity/authority,
commands, diagnostics and secure buttons. Extract and test those dependencies
before packaging a separate addon. Give that addon its own TOC, saved variables,
commands, version, package and release checklist.

Target icons and floor markers use native game functionality; other players
do not need the addon to see supported native markers. Custom boss-plan popups
require receiving addon code on each viewer. For a leader-only installation,
start with plans posted to ordinary raid chat instead of promising popups.

Existing Guilded saved fields `raidPlans`, `markerWindow`, `markersShown` and
old module preferences remain untouched. Design an explicit, non-destructive
import later. Never erase or replace Guilded SavedVariables during extraction.

Upgrade by installing the complete Guilded package, including Guilded.toc.
An old Modules/RaidTools.lua left by an overlay installation is no longer loaded.
The new ZIP contains no RaidTools.lua. No database or protocol change is needed.

Standalone acceptance must cover leader/assistant permissions, actual client
marker support, combat restrictions, saved position/scale, chat pacing and
installation without Guilded. Do not count archived mock tests as live passes.
