import { createDungeonRatingRules } from "./dungeon-rating.js";

export const BETA_PRESET_ID = "forever-beta-2026-10-13-v1";
export const BETA_SEASON_NAME = "Quebec Gold - Beta finale Oct 22";
// Exclusive: midnight after October 22 in America/Toronto (EDT).
export const BETA_SEASON_END = "2026-10-23T04:00:00.000Z";
export const BETA_LEVEL_CAP = 30;
export const BETA_LEVEL_SOURCES = {
  client: "https://foreverdb.net/dungeons",
  access: "https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-october-8/2360696/1",
  scarlet: "https://www.wowhead.com/forever/guide/scarlet-monastery-graveyard-dungeon-overview-location-rewards"
} as const;

// These are DESIGN targets for this short guild season, not Blizzard timers or
// measured population averages. See docs/DUNGEON_BETA_PRESET_2026-10.md.
export const BETA_DUNGEONS = [
  { key: "389", instanceId: 389, name: "Ragefire Chasm", min: 13, max: 18, minutes: 20, source: "client" },
  { key: "3065", instanceId: 3065, name: "The Hall of Thanes", min: 13, max: 20, minutes: 25, source: "client" },
  { key: "43", instanceId: 43, name: "Wailing Caverns", min: 15, max: 24, minutes: 40, source: "client" },
  { key: "2999", instanceId: 2999, name: "Ruins of Lordaeron", min: 15, max: 22, minutes: 35, source: "client" },
  { key: "36", instanceId: 36, name: "The Deadmines", min: 17, max: 26, minutes: 40, source: "client" },
  { key: "33", instanceId: 33, name: "Shadowfang Keep", min: 20, max: 30, minutes: 30, source: "client" },
  { key: "34", instanceId: 34, name: "The Stockade", min: 24, max: 30, minutes: 20, source: "client" },
  { key: "48", instanceId: 48, name: "Blackfathom Deeps", min: 24, max: 30, minutes: 40, source: "client" },
  { key: "129", instanceId: 129, name: "Razorfen Downs", min: 25, max: 30, minutes: 40, source: "access" },
  { key: "2998", instanceId: 2998, name: "Excavation Site: Wetlands", min: 26, max: 30, minutes: 35, source: "client" },
  { key: "189:graveyard", instanceId: 189, name: "Scarlet Monastery: Graveyard", min: 26, max: 30, minutes: 15, source: "scarlet" },
  { key: "2959", instanceId: 2959, name: "City of Dalaran", min: 28, max: 30, minutes: 45, source: "client" },
  { key: "90", instanceId: 90, name: "Gnomeregan", min: 29, max: 30, minutes: 45, source: "client" },
  { key: "47", instanceId: 47, name: "Razorfen Kraul", min: 29, max: 30, minutes: 35, source: "client" },
  { key: "189:library", instanceId: 189, name: "Scarlet Monastery: Library", min: 29, max: 30, minutes: 25, source: "scarlet" },
  { key: "70", instanceId: 70, name: "Uldaman", min: 30, max: 30, minutes: 50, source: "access" }
] as const;

export function betaSeasonRules() {
  return { ...createDungeonRatingRules(
    Object.fromEntries(BETA_DUNGEONS.map(d => [d.key, d.minutes * 60])), 3,
    Object.fromEntries(BETA_DUNGEONS.map(d => [d.key, { min: d.min, max: d.max, difficultyId: 0 }]))),
  presetId: BETA_PRESET_ID, provisionalTargets: true,
  catalog: BETA_DUNGEONS.map(d => ({ dungeonKey: d.key, instanceId: d.instanceId, name: d.name, targetSec: d.minutes * 60,
    minLevel: d.min, maxLevel: d.max, provisional: true })) };
}
