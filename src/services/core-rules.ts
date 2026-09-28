import type { GuildSettings, PrismaClient, RaidCore } from "@prisma/client";

// Point rules per raid core. Every core follows the guild's settings (from
// /setup config and /setup) unless it overrides a value with /core rules, so a
// guild that never touches /core rules gets identical rules for all cores.
// A core may also keep its own point pool (its EP/GP are separate from the
// guild pool and from other cores').

// How a raid's loot is decided. A core picks one (or follows the guild's choice).
//   EPGP      players bid GP, the highest bid wins
//   COUNCIL   raiders say how much they want it (BiS / upgrade / off-spec), officers decide
//   RESERVE   soft reserves: reservers roll for the item they reserved
//   PRIORITY  every item has a set GP price; it goes to the highest PR of those who want it
export type LootMode = "EPGP" | "COUNCIL" | "RESERVE" | "PRIORITY";
export const LOOT_MODES: LootMode[] = ["EPGP", "COUNCIL", "RESERVE", "PRIORITY"];
export const LOOT_MODE_LABEL: Record<LootMode, string> = {
  EPGP: "GP bids", COUNCIL: "loot council", RESERVE: "soft reserves", PRIORITY: "EPGP priority (set prices)"
};
export const LOOT_MODE_HELP: Record<LootMode, string> = {
  EPGP: "Players bid GP; the highest bid wins and pays it.",
  COUNCIL: "Raiders answer BiS / upgrade / off-spec; officers decide. GP only if you give a price.",
  RESERVE: "Players reserve items before the raid; the reservers of a dropped item roll for it.",
  PRIORITY: "Every item has a set GP price. It goes to the highest PR of the players who want it, and they pay that price."
};
export const asLootMode = (value: string | null | undefined): LootMode => (LOOT_MODES as string[]).includes(value ?? "") ? (value as LootMode) : "EPGP";

export interface EffectiveRules {
  attendanceEp: number;
  lateEp: number;
  bossEp: number;
  completionEp: number;
  baseGp: number;
  decayPercent: number;
  lootMode: LootMode;
  // Soft reserves each player may hold (RESERVE mode; the officer can still choose when opening the list).
  reservesPerPlayer: number;
  separatePool: boolean;
  // Share of the GP an off-spec winner pays (percent, default 50) and the EP a player needs before
  // they take priority over players below it (EPGP minimum EP, default 0 = off).
  offspecPercent: number;
  minEp: number;
  // Which values this core changed (the rest are the guild default).
  overridden: string[];
}

type CoreRules = Pick<RaidCore, "attendanceEp" | "lateEp" | "bossEp" | "completionEp" | "baseGp" | "decayPercent" | "lootMode" | "separatePool" | "reservesPerPlayer" | "offspecPercent" | "minEp">;
export const DEFAULT_OFFSPEC_PERCENT = 50;
type GuildRules = Pick<GuildSettings, "attendanceDkp" | "lateAttendanceDkp" | "bossKillDkp" | "epCompletionBonus" | "baseGp" | "epgpDecayPercent" | "lootMode">;

export function effectiveRules(guild: Partial<GuildRules> | null | undefined, core: Partial<CoreRules> | null | undefined): EffectiveRules {
  const overridden: string[] = [];
  const pick = <T>(name: string, own: T | null | undefined, fallback: T): T => {
    if (own !== null && own !== undefined) { overridden.push(name); return own; }
    return fallback;
  };
  const attendanceEp = pick("attendance EP", core?.attendanceEp, guild?.attendanceDkp ?? 10);
  const lateEp = pick("late EP", core?.lateEp, guild?.lateAttendanceDkp ?? 5);
  const bossEp = pick("boss EP", core?.bossEp, guild?.bossKillDkp ?? 5);
  const completionEp = pick("full-clear EP", core?.completionEp, guild?.epCompletionBonus ?? 0);
  const baseGp = pick("base GP", core?.baseGp, guild?.baseGp ?? 0);
  const decayPercent = pick("decay", core?.decayPercent, guild?.epgpDecayPercent ?? 0.1);
  const mode = pick("loot mode", core?.lootMode, guild?.lootMode ?? "EPGP");
  const reservesPerPlayer = Math.max(1, Math.min(5, pick("reserves", core?.reservesPerPlayer, 1)));
  const separatePool = core?.separatePool === true;
  if (separatePool) overridden.push("separate pool");
  const offspecPercent = Math.max(0, Math.min(100, pick("off-spec", core?.offspecPercent, DEFAULT_OFFSPEC_PERCENT)));
  const minEp = Math.max(0, pick("minimum EP", core?.minEp, 0));
  return {
    attendanceEp, lateEp, bossEp, completionEp, baseGp, decayPercent,
    lootMode: asLootMode(mode),
    reservesPerPlayer,
    separatePool,
    offspecPercent,
    minEp,
    overridden
  };
}

// "attendance 10 EP (default), boss 0 EP (this core), ..." for /core rules and /core show.
export function describeRules(rules: EffectiveRules, coreName: string): string {
  const mark = (name: string) => (rules.overridden.includes(name) ? "core" : "default");
  return [
    `**${coreName}** rules (${rules.overridden.length ? `${rules.overridden.length} differ from the guild` : "same as the guild"}):`,
    `• Attendance ${rules.attendanceEp} EP (${mark("attendance EP")}) · late ${rules.lateEp} EP (${mark("late EP")})`,
    `• Per boss ${rules.bossEp} EP (${mark("boss EP")}) · full clear +${rules.completionEp} EP (${mark("full-clear EP")})`,
    `• Base GP ${rules.baseGp} (${mark("base GP")}) · decay ${Math.round(rules.decayPercent * 100)}% (${mark("decay")})`,
    `• Loot: ${LOOT_MODE_LABEL[rules.lootMode]} (${mark("loot mode")})${rules.lootMode === "RESERVE" ? ` · ${rules.reservesPerPlayer} reserve(s) per player (${mark("reserves")})` : ""}`,
    `• Off-spec pays ${rules.offspecPercent}% of the GP (${mark("off-spec")}) · minimum EP for priority ${rules.minEp || "off"} (${mark("minimum EP")})`,
    `• Points: ${rules.separatePool ? "this core has its **own point pool**" : "shared guild pool"}`
  ].join("\n");
}

type Db = Pick<PrismaClient, "raid">;

// The core a raid was created for (with its rules), or null.
export async function coreForRaid(database: Db, guildId: string, raidId: string | null | undefined) {
  if (!raidId) return null;
  const raid = await database.raid.findFirst({ where: { id: raidId.trim(), guildId }, include: { core: true } });
  return raid?.core ?? null;
}

// Which pool a raid's points go to: the core's id when it has its own pool,
// otherwise null (the guild pool).
export const poolFor = (core: Pick<RaidCore, "id" | "separatePool"> | null | undefined): string | null =>
  core?.separatePool ? core.id : null;
