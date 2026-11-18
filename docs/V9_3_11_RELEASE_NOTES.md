# Guilded 9.3.11 — release notes (18 November 2026)

**Raid progress.** Published 18 November 2026. Protocol 2, WoW Forever only. Bot migrations `20270304090000_raid_kills` and `20270304093000_weekly_records_post` are already applied on the live bot.

Real-client checks: docs/V9_3_11_RELEASE_ACCEPTANCE.md. 9.3.11 is not yet confirmed on real clients.

## What changes for members

- **Raid progress:** when WoW Forever's raids open on 9 December, your guild's boss kills reach the public raid progress board on their own.
- **Already live on the website:** player and guild pages are easier to find, link to the WoW armory, and every dungeon has its fastest and first clear.

## In short (English)

Guilded 9.3.11: raid boss kills recorded for the raid progress board, ready for 9 December.

## En bref (français)

Guilded 9.3.11 : les boss de raid tués sont enregistrés pour le classement de progression des raids, prêt pour le 9 décembre.

## Technical

- Addon: Modules/RaidProgress.lua (ENCOUNTER_END in a raid instance, BOSS_KILL fallback), GuildedDB.raidProgress. Companion: exportRaidKills, device upload field. Bot: #1106, #1107, #1108 already live.
