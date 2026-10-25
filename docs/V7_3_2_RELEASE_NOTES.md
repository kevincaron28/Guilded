# Guilded 7.3.2 Release — 25 October 2026

The Guilded addon, standalone Guilded Dungeons, Discord bot, website and Windows
companion now support WoW Forever, Classic Era/Hardcore, TBC Anniversary,
Mists Classic and Retail. Protocol remains 2.

The owner approved release before the remaining game/two-PC tests because the
Forever client is unavailable until launch. These tests are pending follow-up,
not recorded passes. Dungeon targets are provisional and require real-run
calibration. See [the game checklist](V7_3_2_GAME_CHECKLIST.md) and
[the release decision](RELEASE_DECISION_2026-10-25.md).

## What changed

- Several guilds and WoW editions can share one Discord server. Select the guild
  with `/wow use`, or bind its channel with `/wow channel`. Permissions, character
  links, settings, public seasons and uploads stay separated by guild and edition.
- Forever characters display their authentic first and last names while retaining
  their existing accounting keys. Other editions use character and realm identities.
- Desktop and browser companions support separate saved connections. Pair each
  guild/edition independently; only the selected connection syncs.
- 135 source-reviewed ordinary dungeon routes cover Era, TBC, Mists and Retail,
  with difficulty-specific evidence and explicit provisional benchmarks. Classic
  NPC-only completion evidence is supported. Other content remains recorded activity.
- Retail preserves native key level, affixes, timer and completion eligibility.
  Its eight-dungeon Midnight Season 2 rating sums one best score per dungeon.
  The provisional Guilded formula is inspired by Raider.IO; it is not an official
  Raider.IO or Blizzard score. `/dungeon keystones` and character pages show results.
- Dungeon scores include role context, improvement guidance and season history.
  Guilded Dungeons can receive personal public-score snapshots. Historic scoring
  rules remain frozen; recalibration applies prospectively.
- Raid seat presets are editable; new signup posts use Discord Components V2.
  Public score/run cards, French companion screens and installation guidance improve.
- Companion refreshes avoid unnecessary log noise, repair missing standings files,
  and preserve pairing/settings on update. Installed-app startup is corrected.
- Bot database timestamps use UTC. Updates stage dependencies before replacing
  the service and retain the previous application for code recovery. The existing
  dungeon history reset boundary is preserved.

## Choose your download

Use **Guilded-v7.3.2-<edition>.zip** for guild/loot tools or
**GuildedDungeons-v7.3.2-<edition>.zip** for standalone dungeon tracking.

| Client | Filename edition |
| --- | --- |
| WoW Forever | `forever` |
| Classic Era / Hardcore | `classic-era` |
| TBC Anniversary | `classic-tbc` |
| Mists Classic | `classic-mists` |
| Retail | `retail` |

The unsuffixed `Guilded-v7.3.2.zip` and `GuildedDungeons-v7.3.2.zip` are the
Forever builds. Do not install those unsuffixed builds into a Blizzard client.
All editions use the same **Guilded.Companion.Setup.7.3.2.exe**. Extract the addon
folder into the selected client's `Interface/AddOns`. Preserve SavedVariables.
Use the separate checksum manifest to verify downloads.

The installer is unsigned. Interface baselines are Forever 16001, Era 11500,
TBC 20506, Mists 50500 and Retail 120105; actual launch-client confirmation is
still pending. No client test result is invented. Historical leveling/timewalking,
Season of Discovery and Mists challenge modes are outside this rating catalog.

Existing users on the private 7.3.2 candidate should run this published installer
once to receive the final 7.3.2 files; the version number is unchanged. Public
7.3.1 and earlier companions can use their normal update flow.

Self-hosters must back up first, deploy the matching source/migrations, and verify
health plus command registration. Do not start a second process with the same
Discord token. Full setup: [multi-edition release scope](RELEASE_SCOPE_2026-10-25.md).
