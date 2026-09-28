import { z } from "zod";

// Dungeon Challenge rules (roadmap D3/D4): what a valid run is, and how
// points are earned. Pure functions, so they're easy to test and change.

export const SUPPORTED_PROTOCOLS = [1];
export const MIN_DURATION_SEC = 180;
export const MAX_DURATION_SEC = 4 * 60 * 60;

// One run as the companion exports it. Parsed per run, so one bad run is
// rejected on its own instead of failing the whole import.
export const dungeonRunSchema = z.object({
  id: z.string().min(3).max(100),
  protocolVersion: z.number().int(),
  addonVersion: z.string().max(40).optional(),
  state: z.string().max(20),
  instanceId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  difficultyId: z.number().int().nonnegative().default(0),
  startedAt: z.number().int().positive().optional(),
  endedAt: z.number().int().positive().optional(),
  completedBy: z.string().max(40).optional(),
  endReason: z.string().max(80).optional(),
  recorder: z.string().max(40).optional(),
  reporters: z.number().int().nonnegative().default(1),
  // Characters whose addon reported the run (newer companions only).
  reporterNames: z.array(z.string().min(1).max(40)).max(10).optional(),
  players: z.array(z.object({
    character: z.string().min(1).max(40),
    realm: z.string().min(1).max(60),
    class: z.string().max(20).optional(),
    role: z.string().max(10).optional(),
    deaths: z.number().int().nonnegative().max(500).nullable().optional(),
    presentSec: z.number().int().nonnegative().default(0),
    inGuild: z.boolean().default(false)
  })).max(40)
});
export type DungeonRunInput = z.infer<typeof dungeonRunSchema>;

export interface DungeonConfig {
  completion: number;
  noDeaths: number;
  oneDeath: number;
  twoDeaths: number;
  personalRecord: number;
  guildRecord: number;
  firstCompletion: number;
  fullGuildGroup: number;
  underTarget: number;
  // Target times per instance id, in seconds (for the "under target" bonus).
  targets: Record<string, number>;
  // Share of points for a player's 1st, 2nd, 3rd... completion of the same
  // dungeon in one week; runs past the end of the list use the last value.
  weeklyRepeat: number[];
  // Different dungeons needed for the Dungeon Master achievement.
  dungeonMasterCount: number;
}

export const DEFAULT_DUNGEON_CONFIG: DungeonConfig = {
  completion: 50,
  noDeaths: 25,
  oneDeath: 15,
  twoDeaths: 5,
  personalRecord: 15,
  guildRecord: 25,
  firstCompletion: 25,
  fullGuildGroup: 20,
  underTarget: 20,
  targets: {},
  weeklyRepeat: [1, 0.5, 0],
  dungeonMasterCount: 10
};

// Guild settings JSON on top of the defaults; bad values fall back.
export function dungeonConfig(stored: unknown): DungeonConfig {
  const config: DungeonConfig = { ...DEFAULT_DUNGEON_CONFIG, targets: {}, weeklyRepeat: [...DEFAULT_DUNGEON_CONFIG.weeklyRepeat] };
  if (!stored || typeof stored !== "object") return config;
  const input = stored as Record<string, unknown>;
  for (const key of ["completion", "noDeaths", "oneDeath", "twoDeaths", "personalRecord", "guildRecord", "firstCompletion", "fullGuildGroup", "underTarget"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000) config[key] = Math.round(value);
  }
  if (input["targets"] && typeof input["targets"] === "object") {
    for (const [id, seconds] of Object.entries(input["targets"] as Record<string, unknown>)) {
      if (typeof seconds === "number" && seconds > 0) config.targets[id] = Math.round(seconds);
    }
  }
  if (Array.isArray(input["weeklyRepeat"]) && input["weeklyRepeat"].length > 0 && input["weeklyRepeat"].every((v) => typeof v === "number" && v >= 0 && v <= 1)) {
    config.weeklyRepeat = input["weeklyRepeat"] as number[];
  }
  const master = input["dungeonMasterCount"];
  if (typeof master === "number" && Number.isInteger(master) && master >= 1 && master <= 100) config.dungeonMasterCount = master;
  return config;
}

export interface Validation { ok: boolean; reason?: string }

// Server-side checks: the addon is never trusted blindly.
export function validateRun(run: DungeonRunInput, now = new Date()): Validation {
  if (!SUPPORTED_PROTOCOLS.includes(run.protocolVersion)) return { ok: false, reason: `unsupported protocol ${run.protocolVersion}` };
  if (!["COMPLETED", "ABANDONED", "INVALID"].includes(run.state)) return { ok: false, reason: `unexpected state ${run.state}` };
  if (run.players.length < 1 || run.players.length > 5) return { ok: false, reason: `${run.players.length} players (dungeons are 1-5)` };
  const nowSec = Math.floor(now.getTime() / 1000);
  const earliest = Date.UTC(2024, 0, 1) / 1000;
  for (const stamp of [run.startedAt, run.endedAt]) {
    if (stamp === undefined) continue;
    if (stamp > nowSec + 600) return { ok: false, reason: "timestamp in the future" };
    if (stamp < earliest) return { ok: false, reason: "timestamp too old" };
  }
  if (run.state !== "COMPLETED") return { ok: true };
  if (!run.startedAt || !run.endedAt) return { ok: false, reason: "completed run without start and end times" };
  const duration = run.endedAt - run.startedAt;
  if (duration < MIN_DURATION_SEC) return { ok: false, reason: `too short (${duration}s)` };
  if (duration > MAX_DURATION_SEC) return { ok: false, reason: `too long (${Math.round(duration / 60)} min)` };
  const names = new Set(run.players.map((player) => player.character.toLowerCase()));
  if (names.size !== run.players.length) return { ok: false, reason: "same player listed twice" };
  // A run is only believed from someone who was in it: the recorder, and at least one of
  // the reporters when the companion says who they were.
  if (run.recorder && !names.has(run.recorder.toLowerCase())) return { ok: false, reason: "recorder was not in the run" };
  if (run.reporterNames && run.reporterNames.length > 0
    && !run.reporterNames.some((name) => names.has(name.toLowerCase()))) {
    return { ok: false, reason: "no reporter was in the run" };
  }
  return { ok: true };
}

// Weekly reset: Tuesday 15:00 UTC (the WoW Americas weekly reset).
export function weekStart(date: Date): Date {
  const reset = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 15, 0, 0));
  const daysSinceTuesday = (reset.getUTCDay() - 2 + 7) % 7;
  reset.setUTCDate(reset.getUTCDate() - daysSinceTuesday);
  if (reset.getTime() > date.getTime()) reset.setUTCDate(reset.getUTCDate() - 7);
  return reset;
}

export interface PlayerContext {
  memberId: string;
  character: string;
  deaths: number | null | undefined;
  // Valid completions of this dungeon by this player earlier this week.
  earlierThisWeek: number;
  firstEver: boolean;
  // Their best time before this run (null = none).
  previousBest: number | null;
}

export interface PointAward { memberId: string; character: string; rule: string; amount: number; reason: string }

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

// Points for one completed, valid run. Death bonuses only when deaths were
// actually tracked for that player (never assume zero).
export function computeRunPoints(input: {
  instanceId: number;
  durationSec: number;
  fullGuildGroup: boolean;
  guildRecord: boolean;
  players: PlayerContext[];
  config: DungeonConfig;
}): PointAward[] {
  const { config } = input;
  const awards: PointAward[] = [];
  const target = input.config.targets[String(input.instanceId)];
  for (const player of input.players) {
    const share = config.weeklyRepeat[Math.min(player.earlierThisWeek, config.weeklyRepeat.length - 1)] ?? 0;
    const note = player.earlierThisWeek > 0 ? ` (run ${player.earlierThisWeek + 1} this week: ${Math.round(share * 100)}%)` : "";
    const add = (rule: string, base: number, reason: string) => {
      const amount = Math.round(base * share);
      if (amount > 0) awards.push({ memberId: player.memberId, character: player.character, rule, amount, reason: reason + note });
    };
    add("completion", config.completion, "Dungeon completion");
    if (player.deaths === 0) add("noDeaths", config.noDeaths, "No deaths");
    else if (player.deaths === 1) add("oneDeath", config.oneDeath, "1 death");
    else if (player.deaths === 2) add("twoDeaths", config.twoDeaths, "2 deaths");
    if (player.firstEver) add("firstCompletion", config.firstCompletion, "First completion of this dungeon");
    if (player.previousBest !== null && input.durationSec < player.previousBest) {
      add("personalRecord", config.personalRecord, `Personal record (${formatDuration(player.previousBest)} → ${formatDuration(input.durationSec)})`);
    }
    if (input.guildRecord) add("guildRecord", config.guildRecord, "Guild record");
    if (input.fullGuildGroup) add("fullGuildGroup", config.fullGuildGroup, "Full guild group");
    if (target && input.durationSec <= target) add("underTarget", config.underTarget, `Under the target time (${formatDuration(target)})`);
  }
  return awards;
}
