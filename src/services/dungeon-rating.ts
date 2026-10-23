import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import type { Lang } from "../i18n.js";
import { bracketForLevel, novemberDungeonKey, resolveNovemberRoute, routeTargetAt, validBracketedRules, validNovemberRules,
  type BracketedRules, type DungeonBracket, type NovemberRules } from "./dungeon-november-rules.js";

// Version 1 remains readable forever. New seasons use a frozen version 3 copy.
export const DUNGEON_RATING_RULES = { version: 1, model: "distinct-dungeons", pointsPerDungeon: 100,
  speedBonus: 0, minimumPresence: 0.8, automaticCompletionOnly: true } as const;
export interface LevelBand { min: number; max: number; difficultyId: number }
export function validLevelBand(value: unknown): value is LevelBand {
  if (!value || typeof value !== "object") return false;
  const b = value as LevelBand;
  return Number.isInteger(b.min) && Number.isInteger(b.max) && b.min >= 1 && b.max <= 100 && b.min <= b.max
    && Number.isInteger(b.difficultyId) && b.difficultyId >= 0;
}
export function validDungeonKey(key: string): boolean {
  return /^[1-9]\d*$/.test(key) || /^189:(graveyard|library|armory|cathedral)$/.test(key);
}
// Match successful boss evidence, never a player's freely entered dungeon label.
// Unsupported locales/ambiguous mixed-wing runs remain unranked.
export function ratingDungeonKey(run: RatingRun): string {
  if (run.instanceId !== 189) return String(run.instanceId);
  const encounters = (run.competitionData as { encounters?: { name?: string; success?: boolean }[] } | null)?.encounters;
  const names = new Set((Array.isArray(encounters) ? encounters : []).filter(e => e?.success === true).map(e => e.name?.toLowerCase()));
  const matches = SCARLET_WINGS.filter(([, bosses]) => bosses.some(name => names.has(name)));
  return matches.length === 1 ? `189:${matches[0]![0]}` : "189";
}
// Scarlet Monastery shares map 189; each wing is told apart by its last boss (English, French).
export const SCARLET_WINGS = [
  ["graveyard", ["bloodmage thalnos", "mage de sang thalnos"]],
  ["library", ["arcanist doan", "arcaniste doan"]],
  ["armory", ["herod", "hérode"]],
  ["cathedral", ["high inquisitor whitemane", "grande inquisitrice blanchetête"]]
] as const;
export function createDungeonRatingRules(targets: Record<string, number> = {}, version: 2 | 3 = 3, bands: Record<string, LevelBand> = {}) {
  const frozen: Record<string, number> = {};
  for (const [id, seconds] of Object.entries(targets)) {
    if (validDungeonKey(id) && Number.isFinite(seconds) && seconds >= 1 && seconds <= 14400) frozen[id] = Math.round(seconds);
  }
  const levelBands = Object.fromEntries(Object.entries(bands).filter(([id, band]) => validDungeonKey(id) && validLevelBand(band)).map(([id, b]) => [id, { ...b }]));
  return version === 2
    ? { ...DUNGEON_RATING_RULES, version: 2, speedBonus: 20, fullBonusFasterFraction: 0.3, targets: frozen }
    : { ...DUNGEON_RATING_RULES, version: 3, pointsPerDungeon: 200, speedBonus: 0, minimumScore: 50, maximumScore: 400, targets: frozen, levelBands };
}
export function hasDungeonRating(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  if (rule["version"] === 5) return validNovemberRules(value);
  if (rule["version"] === 6) return validBracketedRules(value);
  const validTargets = !!rule["targets"] && typeof rule["targets"] === "object" && !Array.isArray(rule["targets"])
    && Object.entries(rule["targets"]).every(([id, seconds]) => validDungeonKey(id)
      && typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 1 && seconds <= 14400);
  const bestEight = rule["version"] === 4 && rule["bestCount"] === 8 && rule["competitionLevel"] === 30
    && rule["participationModel"] === "weekly-variety-v1"
    && !!rule["participationLevelBands"] && typeof rule["participationLevelBands"] === "object" && !Array.isArray(rule["participationLevelBands"])
    && Object.entries(rule["participationLevelBands"]).every(([id, b]) => validDungeonKey(id) && validLevelBand(b))
    && !!rule["levelBands"] && typeof rule["levelBands"] === "object"
    && Object.values(rule["levelBands"]).every(b => validLevelBand(b) && b.min === 30 && b.max === 30);
  const version = rule["version"] === 1 && rule["speedBonus"] === 0 && rule["pointsPerDungeon"] === 100
    || rule["version"] === 2 && rule["pointsPerDungeon"] === 100 && rule["speedBonus"] === 20 && rule["fullBonusFasterFraction"] === 0.3 && validTargets
    || (rule["version"] === 3 || bestEight) && rule["pointsPerDungeon"] === 200 && rule["speedBonus"] === 0
      && !!rule["levelBands"] && typeof rule["levelBands"] === "object" && !Array.isArray(rule["levelBands"])
      && Object.entries(rule["levelBands"]).every(([id, b]) => validDungeonKey(id) && validLevelBand(b))
      && rule["minimumScore"] === 50 && rule["maximumScore"] === 400 && validTargets;
  return version && rule["model"] === "distinct-dungeons"
    && rule["minimumPresence"] === 0.8 && rule["automaticCompletionOnly"] === true;
}
export interface DungeonRatingDetail {
  instanceId: number; name: string; points: number; speedBonus: number; durationSec: number;
  targetSec: number | null; runRef: string; dungeonKey?: string; ratingVersion?: 3 | 4 | 5 | 6; counted?: boolean; penaltyPercent?: number; unrankedReason?: string; bosses?: BossRecord[];
}
// Version 6 rows are per character AND bracket; each row freezes its bracket's best-N.
export interface RatingRow { memberId: string; character?: string; name: string; points: number; dungeons: number; details?: DungeonRatingDetail[]; bracket?: string; bestCount?: number;
  level?: number; roles?: { role: string; points: number; details: DungeonRatingDetail[] }[] }
// Runs retain the actual character name. Keep the owner for membership and
// permissions, but never use their account alone as the competitive identity.
// Scoped to one guild by dungeonRating; Forever realm labels are not stable.
export function ratingCharacterKey(memberId: string, character: string): string {
  return JSON.stringify([memberId, character.trim().toLowerCase()]);
}
export interface BossRecord { id: number; name: string; durationSec: number; runRef: string }
export interface RatingRun {
  competitionData?: unknown; difficultyId?: number; startedAt?: Date | null; endedAt?: Date | null; completedBy?: string | null;
  instanceId: number; durationSec: number | null; dungeonName?: string; runRef?: string;
  players: { character?: string; memberId: string | null; role?: string | null; presentSec: number; member: { displayName: string } | null }[];
}
export function speedPoints(seconds: number, target: number | null): number {
  return target ? Math.round(20 * Math.max(0, Math.min(1, (target - seconds) / (0.3 * target)))) : 0;
}
// A target is a benchmark, not a completion reward. Uncalibrated runs stay visible at zero.
export function timeRating(seconds: number, target: number | null): number {
  return target && seconds > 0 ? Math.max(50, Math.min(400, Math.round(200 * target / seconds))) : 0;
}
// Version 6 lets a participant be up to `allowance` levels above the band, for a penalty.
export function competitionReason(run: RatingRun, band: LevelBand | undefined, allowance = 0): string | undefined {
  if (!band) return "Level range not configured";
  if (run.difficultyId !== band.difficultyId) return "Different difficulty";
  const data = run.competitionData as { players?: { name: string; level: number | null; minLevel: number | null }[] } | null;
  if (!Array.isArray(data?.players) || data.players.length !== run.players.length || !data.players.length) return "Party levels unknown";
  const seen = new Set<string>();
  for (const p of data.players) {
    if (!p || typeof p.name !== "string" || seen.has(p.name) || !run.players.some(r => r.character === p.name)
      || !Number.isInteger(p.level) || !Number.isInteger(p.minLevel) || p.minLevel! < 1 || p.level! > 100 || p.minLevel! > p.level!) return "Party levels unknown";
    seen.add(p.name);
  }
  if (data.players.some(p => p.level! > band.max + allowance)) return "Overlevel carry";
  if (data.players.some(p => p.minLevel! < band.min)) return "Below level range";
  return undefined;
}
/** Levels the highest participant is above the band (0 when none is); call after competitionReason. */
export function overlevelBy(run: RatingRun, band: LevelBand): number {
  const players = (run.competitionData as { players?: { level: number | null }[] } | null)?.players ?? [];
  return Math.max(0, ...players.map(p => (p.level ?? 0) - band.max));
}
/** A rating reduced by a whole-number percentage, rounded once. */
export function penalized(points: number, percent: number): number {
  return Math.round(points * (100 - percent) / 100);
}
// One eligibility check for guild seasons and the public leaderboards (public-score.ts), so the
// same run with the same evidence ranks the same way in both.
/** Ranked runs end on the addon's automatic final-boss detection, never a manual stop. */
export function completionReason(completedBy: string | null | undefined): string | undefined {
  return completedBy === "final boss" ? undefined : "Automatic final-boss completion required";
}
/** A participant earns a ranked run only when inside it for 80% of its time. */
export function presentEnough(presentSec: number, durationSec: number): boolean {
  return Number.isFinite(presentSec) && presentSec >= durationSec * DUNGEON_RATING_RULES.minimumPresence;
}
/** Version 6: the run's route from boss evidence, why it is unranked (if it is), its over-level penalty and target. */
export function bracketedVerdict(run: RatingRun, rules: BracketedRules): ReturnType<typeof resolveNovemberRoute> & { penaltyPercent: number; targetSec: number | null } {
  const route = resolveNovemberRoute(run, rules);
  const band = rules.levelBands[route.key];
  const reason = route.reason ?? (!rules.targets[route.key] ? "Participation-only route" : competitionReason(run, band, rules.overlevelPenalty.maxLevels));
  return { ...route, ...(reason ? { reason } : {}), penaltyPercent: !reason && band ? overlevelBy(run, band) * rules.overlevelPenalty.percentPerLevel : 0,
    targetSec: routeTargetAt(rules, route.key, run.endedAt) ?? null };
}
function bossRecords(run: RatingRun): BossRecord[] {
  const data = run.competitionData as { encounters?: unknown[] } | null;
  if (!Array.isArray(data?.encounters) || !run.startedAt || !run.endedAt) return [];
  return data.encounters.flatMap(raw => {
    const e = raw as { id?: number; name?: string; success?: boolean; at?: number; startedAt?: number } | null;
    if (!e || e.success !== true || !Number.isInteger(e.id) || e.id! <= 0 || !Number.isInteger(e.at) || !Number.isInteger(e.startedAt)
      || e.startedAt! < run.startedAt!.getTime() / 1000 || e.at! > run.endedAt!.getTime() / 1000 || e.at! <= e.startedAt!) return [];
    return [{ id: e.id!, name: typeof e.name === "string" ? e.name.slice(0, 100) : `#${e.id}`, durationSec: e.at! - e.startedAt!, runRef: run.runRef ?? "" }];
  });
}
export function calculateDungeonRating(runs: RatingRun[], rules?: unknown): RatingRow[] {
  if (rules !== undefined && !hasDungeonRating(rules)) return [];
  const version = (rules as { version?: number } | undefined)?.version;
  const timed = version === 3 || version === 4 || version === 5 || version === 6;
  const bestEight = version === 4 || version === 5 || version === 6;
  const brackets = version === 6 ? rules as BracketedRules : undefined;
  const targets = version === 2 || timed
    ? (rules as ReturnType<typeof createDungeonRatingRules>).targets : {};
  const members = new Map<string, { memberId: string; name: string; bracket?: DungeonBracket; bests: Map<string, DungeonRatingDetail> }>();
  for (const run of runs) {
    if (!run.durationSec || !Number.isFinite(run.durationSec) || run.durationSec <= 0) continue;
    const verdict = brackets ? bracketedVerdict(run, brackets) : undefined;
    const route = verdict ?? (version === 5 ? resolveNovemberRoute(run, rules as NovemberRules) : undefined);
    const key = route?.key ?? (timed ? ratingDungeonKey(run) : String(run.instanceId));
    const reason = verdict ? verdict.reason : route?.reason ?? (route && !targets[key] ? "Participation-only route" : !route && timed && key === "189" ? "Dungeon route unknown"
      : timed ? competitionReason(run, (rules as { levelBands?: Record<string, LevelBand> } | undefined)?.levelBands?.[key]) : undefined);
    const penaltyPercent = verdict?.penaltyPercent ?? 0;
    const bosses = timed && !reason && targets[key] ? bossRecords(run) : [];
    for (const player of run.players) {
      if (!player.memberId || !player.member || !player.character?.trim() || !presentEnough(player.presentSec, run.durationSec)) continue;
      // Version 6: the character's level during this run picks the bracket. A ranked
      // run already kept every participant inside the route's band, so it agrees with the route.
      // A ranked run (penalised or not) belongs to its route's bracket; anything else to the player's level.
      const bracket = brackets ? reason ? runBracket(run, player.character, brackets, brackets.routeBracket[key]) : brackets.brackets.find(b => b.key === brackets.routeBracket[key]) : undefined;
      if (brackets && !bracket) continue;
      const identity = ratingCharacterKey(player.memberId, player.character) + (bracket ? `/${bracket.key}` : "");
      const member = members.get(identity) ?? { memberId: player.memberId, name: player.character.trim(), ...(bracket ? { bracket } : {}), bests: new Map<string, DungeonRatingDetail>() };
      const targetSec = verdict ? verdict.targetSec : targets[key] ?? null;
      const speedBonus = timed ? 0 : speedPoints(run.durationSec, targetSec);
      const detail: DungeonRatingDetail = { ...(timed ? { ratingVersion: version as 3 | 4 | 5 | 6, dungeonKey: key, ...(reason || !targetSec ? { unrankedReason: reason ?? "Target not calibrated" } : {}), bosses: [] } : {}), instanceId: run.instanceId, name: route?.route?.name ?? (key.startsWith("189:") ? `Scarlet Monastery: ${key.split(":")[1]}` : run.dungeonName ?? `#${run.instanceId}`), points: timed ? reason ? 0 : penalized(timeRating(run.durationSec, targetSec), targetSec ? penaltyPercent : 0) : 100 + speedBonus,
        ...(penaltyPercent && targetSec ? { penaltyPercent } : {}),
        speedBonus, durationSec: run.durationSec, targetSec, runRef: run.runRef ?? "" };
      const previous = member.bests.get(key);
      const bossBests = new Map((previous?.bosses ?? []).map(b => [b.id, b]));
      for (const boss of bosses) if (!bossBests.has(boss.id) || boss.durationSec < bossBests.get(boss.id)!.durationSec) bossBests.set(boss.id, boss);
      if (timed) detail.bosses = [...bossBests.values()].sort((a, b) => a.id - b.id);
      if (previous && timed) previous.bosses = detail.bosses ?? [];
      if (!previous || detail.points > previous.points || detail.points === previous.points
        && (detail.durationSec < previous.durationSec || detail.durationSec === previous.durationSec && detail.runRef < previous.runRef)) {
        member.bests.set(key, detail);
      }
      members.set(identity, member);
    }
  }
  return [...members.values()].map(member => {
    const details = [...member.bests.values()].sort((a, b) => a.instanceId - b.instanceId || (a.dungeonKey ?? "").localeCompare(b.dungeonKey ?? ""));
    const counted = bestEightKeys(details, member.bracket?.bestCount);
    if (bestEight) for (const detail of details) detail.counted = counted.has(detail.dungeonKey!);
    return { memberId: member.memberId, character: member.name, name: member.name,
      points: details.reduce((sum, best) => sum + (bestEight && !best.counted ? 0 : best.points), 0), dungeons: details.length,
      ...(rules !== undefined ? { details } : {}), ...(member.bracket ? { bracket: member.bracket.key, bestCount: member.bracket.bestCount } : {}) };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId)
    || (a.bracket ?? "").localeCompare(b.bracket ?? ""));
}
// The bracket of the character's own level in this run. Without a recorded
// level, the run is placed in its route's bracket (where it is unranked anyway).
function runBracket(run: RatingRun, character: string, rules: BracketedRules, routeBracket: string | undefined): DungeonBracket | undefined {
  const players = (run.competitionData as { players?: { name?: string; level?: unknown }[] } | null)?.players;
  const level = Array.isArray(players) ? players.find(p => p?.name === character)?.level : undefined;
  return Number.isInteger(level) ? bracketForLevel(rules.brackets, level) : rules.brackets.find(b => b.key === routeBracket);
}
/** The bracket a viewer sees by default: their own best-rated character's. */
export function defaultBracket(rows: RatingRow[], memberId: string | null | undefined): string | undefined {
  return memberId ? rows.find(row => row.memberId === memberId && row.bracket)?.bracket : undefined;
}
// Equal contributions use a stable route key, not duration across unlike dungeons.
function bestEightKeys(details: DungeonRatingDetail[], count = 8): Set<string> {
  return new Set([...details].filter(d => d.points > 0).sort((a, b) => b.points - a.points
    || (a.dungeonKey! < b.dungeonKey! ? -1 : a.dungeonKey! > b.dungeonKey! ? 1 : 0)).slice(0, count).map(d => d.dungeonKey!));
}

function validDetails(row: RatingRow): boolean {
  if (!Array.isArray(row.details) || row.details.length !== row.dungeons) return false;
  const bestEightVersion = row.details.find(d => d?.ratingVersion === 4 || d?.ratingVersion === 5 || d?.ratingVersion === 6)?.ratingVersion;
  const bestEight = bestEightVersion !== undefined;
  if (bestEight && row.details.some(d => d?.ratingVersion !== bestEightVersion || typeof d.dungeonKey !== "string" || !Number.isInteger(d.points))) return false;
  // A bracket row carries its own key and best-N; other versions carry neither.
  if (bestEightVersion === 6 ? typeof row.bracket !== "string" || !/^[a-z0-9][a-z0-9-]{0,19}$/.test(row.bracket)
    || !Number.isInteger(row.bestCount) || row.bestCount! < 1 || row.bestCount! > 20 : row.bracket !== undefined || row.bestCount !== undefined) return false;
  const counted = bestEight ? bestEightKeys(row.details, bestEightVersion === 6 ? row.bestCount : 8) : new Set<string>();
  const ids = new Set<string>();
  let total = 0;
  for (const detail of row.details) {
    const key = detail?.dungeonKey ?? String(detail?.instanceId);
    if (!detail || !Number.isInteger(detail.instanceId) || detail.instanceId <= 0 || ids.has(key) || !(detail.ratingVersion === 5 || detail.ratingVersion === 6 ? novemberDungeonKey(key) : validDungeonKey(key)) || Number(key.split(":")[0]) !== detail.instanceId
      || typeof detail.name !== "string" || typeof detail.runRef !== "string" || !Number.isFinite(detail.durationSec) || detail.durationSec <= 0
      || !Number.isInteger(detail.speedBonus) || detail.speedBonus < 0 || detail.speedBonus > 20
      || detail.targetSec !== null && (!Number.isInteger(detail.targetSec) || detail.targetSec < 1 || detail.targetSec > 14400)) return false;
    if (detail.ratingVersion === 3 || detail.ratingVersion === 4 || detail.ratingVersion === 5 || detail.ratingVersion === 6) {
      // Only version 6 has the over-level penalty; it never applies to an unranked run.
      const penalty = detail.penaltyPercent;
      if (penalty !== undefined && (detail.ratingVersion !== 6 || !Number.isInteger(penalty) || penalty < 1 || penalty > 99 || detail.unrankedReason)) return false;
      if (detail.speedBonus !== 0 || detail.points !== (detail.unrankedReason ? 0 : penalized(timeRating(detail.durationSec, detail.targetSec), penalty ?? 0))) return false;
      if (detail.unrankedReason !== undefined && !["Level range not configured", "Different difficulty", "Party levels unknown", "Overlevel carry", "Below level range", "Target not calibrated", "Dungeon route unknown", ...(detail.ratingVersion === 5 || detail.ratingVersion === 6 ? ["Required encounter evidence missing", "Participation-only route"] : [])].includes(detail.unrankedReason)) return false;
      if (detail.bosses !== undefined && (!Array.isArray(detail.bosses) || detail.bosses.length > 100
        || new Set(detail.bosses.map(b => b.id)).size !== detail.bosses.length
        || detail.bosses.some(b => !Number.isInteger(b.id) || b.id <= 0 || !Number.isInteger(b.durationSec) || b.durationSec <= 0
          || b.durationSec > 14400 || typeof b.name !== "string" || typeof b.runRef !== "string"))) return false;
    } else if (detail.ratingVersion !== undefined || detail.points !== 100 + detail.speedBonus
      || detail.speedBonus !== speedPoints(detail.durationSec, detail.targetSec)) return false;
    if (bestEight ? detail.counted !== counted.has(key) : detail.counted !== undefined) return false;
    ids.add(key); total += bestEight && !detail.counted ? 0 : detail.points;
  }
  return total === row.points;
}
export function frozenRating(value: unknown): RatingRow[] | null {
  if (!Array.isArray(value) || value.some(row => !row || typeof row.memberId !== "string" || typeof row.name !== "string"
    || (row.character !== undefined && (typeof row.character !== "string" || !row.character.trim() || row.name !== row.character))
    || !Number.isInteger(row.points) || row.points < 0 || !Number.isInteger(row.dungeons) || row.dungeons < 0
    || !validFrozenRoles(row)
    || (row.details === undefined ? row.points !== row.dungeons * 100 || row.bracket !== undefined : !validDetails(row)))) return null;
  return value as RatingRow[];
}
function validFrozenRoles(row: RatingRow): boolean {
  if (row.level !== undefined && (!Number.isInteger(row.level) || row.level < 1 || row.level > 100)) return false;
  if (row.roles === undefined) return true;
  return Array.isArray(row.roles) && row.roles.length <= 3 && new Set(row.roles.map(r => r?.role)).size === row.roles.length
    && row.roles.every(r => r && ["TANK", "HEALER", "DAMAGER"].includes(r.role) && Number.isInteger(r.points) && r.points >= 0 && r.points <= row.points
      && Array.isArray(r.details) && (r.details.length === 0 ? r.points === 0 : validDetails({ ...row, ...r, dungeons: r.details.length })));
}
export async function dungeonRating(database: Pick<PrismaClient, "dungeonRun">, guildId: string,
  season: { id: string; startsAt: Date; endsAt?: Date | null; status: string; ratingRules?: unknown; finalRating?: unknown }, instanceId: number | null = null, includeRoles = false): Promise<RatingRow[]> {
  if (!hasDungeonRating(season.ratingRules)) return [];
  if (season.status === "ENDED") {
    const rows = frozenRating(season.finalRating) ?? [];
    if (instanceId === null) return rows;
    if (rows.some(row => row.details === undefined)) throw new Error("Archived per-dungeon details were not recorded for this season.");
    return rows.flatMap(row => {
      const details = row.details?.filter(item => item.instanceId === instanceId) ?? [];
      return details.length ? [{ ...row, points: details.reduce((sum, d) => sum + d.points, 0), dungeons: details.length, details }] : [];
    }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }
  const timed = (season.ratingRules as { version: number }).version >= 3;
  const runs = await database.dungeonRun.findMany({ where: {
    guildId, seasonId: season.id, valid: true, state: "COMPLETED", completedBy: "final boss",
    durationSec: { gt: 0 }, NOT: { runRef: { startsWith: "SIM-" } },
    startedAt: { gte: season.startsAt }, ...(season.endsAt ? { endedAt: { lt: season.endsAt } } : {}),
    ...(instanceId !== null ? { instanceId } : {})
  }, select: { competitionData: true, difficultyId: true, startedAt: true, endedAt: true, completedBy: true, instanceId: true, dungeonName: true, runRef: true, durationSec: true, players: {
    ...(!timed ? { where: { member: { guildId } } } : {}),
    select: { character: true, memberId: true, role: true, presentSec: true, member: { select: { displayName: true, guildId: true } } }
  } } });
  const eligible = timed ? runs.map(run => ({ ...run, players: run.players.map(p => ({ ...p,
    member: p.member?.guildId === guildId ? p.member : null })) })) : runs;
  return includeRoles && validBracketedRules(season.ratingRules) ? ratingWithRoles(eligible, season.ratingRules) : calculateDungeonRating(eligible, season.ratingRules);
}

/** Keep the whole party for eligibility; only award the selected character's recorded role. */
export function ratingWithRoles(runs: RatingRun[], rules: BracketedRules): RatingRow[] {
  const roles = ["TANK", "HEALER", "DAMAGER"].map(role => ({ role, rows: calculateDungeonRating(runs.map(run => ({ ...run,
    players: run.players.map(p => ({ ...p, member: p.role?.toUpperCase() === role ? p.member : null })) })), rules) }));
  return calculateDungeonRating(runs, rules).map(row => {
    const levels = runs.flatMap(run => {
      if (!run.players.some(p => p.memberId === row.memberId && p.character === row.character)) return [];
      const metadata = run.competitionData as { players?: { name: string; level?: number }[] } | null;
      return metadata?.players?.filter(p => p.name === row.character && Number.isInteger(p.level)).map(p => p.level!) ?? [];
    });
    return { ...row, ...(levels.length ? { level: Math.max(...levels) } : {}), roles: roles.map(({ role, rows }) => {
      const match = rows.find(r => r.memberId === row.memberId && r.character === row.character && r.bracket === row.bracket);
      return { role, points: match?.points ?? 0, details: match?.details ?? [] };
    }) };
  });
}
export function ratingEmbed(rows: RatingRow[], seasonName: string, lang: Lang, rules: unknown = DUNGEON_RATING_RULES, bracket?: string): EmbedBuilder {
  if (validBracketedRules(rules)) return bracketRatingEmbed(rows, seasonName, lang, rules, bracket);
  const fr = lang === "fr";
  const speed = hasDungeonRating(rules) && (rules as { version: number }).version === 2;
  const timed = hasDungeonRating(rules) && (rules as { version: number }).version >= 3;
  const bestEight = timed && (rules as { version: number }).version === 4;
  const lines = [timed ? (fr ? "**Score de vitesse · meilleure tentative par donjon**" : "**Dungeon-time rating · best result per dungeon**") : speed ? (fr ? "**100 par donjon distinct + 0–20 de vitesse · meilleure tentative seulement**" : "**100 per distinct dungeon + 0–20 speed · best result only**")
    : fr ? "**100 par donjon distinct · aucun bonus de vitesse**" : "**100 per distinct dungeon · no speed bonus**",
    rows.some(row => row.character === undefined)
      ? (fr ? "Archive par compte : les alts partagent le résultat enregistré." : "Account-based archive: alts share the recorded result.")
      : (fr ? "Score par personnage : chaque alt a ses propres meilleurs parcours. Les égalités partagent le rang."
        : "Per-character rating: each alt has its own best runs. Equal ratings share a rank.")];
  if (timed) lines.push(fr ? "200 à la cible, 50–400 par donjon. Cibles figées. Sans cible : calibration, 0 point."
    : "200 at target, 50–400 per dungeon. Fixed targets. No target: calibrating, 0 points.");
  if (timed) lines.push(fr ? "Arrondi(200 × cible ÷ durée). Somme des meilleurs scores seulement; répétitions non cumulées. Détails : `/dungeon rules`."
    : "Round(200 × target ÷ duration). Sum of best scores only; repeats do not stack. Details: `/dungeon rules`.");
  if (bestEight) lines.push(fr
    ? "**Bêta : les 8 meilleurs donjons/ailes distincts comptent.** Tous les participants doivent rester niveau 30. 1 600 à la cible; maximum 3 200. La couverture au-delà de 8 reste visible, sans points supplémentaires."
    : "**Beta: your best 8 distinct dungeons/wings count.** All participants must remain level 30. 1,600 at target; maximum 3,200. Coverage beyond 8 remains visible without extra points.");
  if (timed && (rules as { version: number }).version === 5) lines.push(fr
    ? "**Niveau 60 : vos 8 meilleurs parcours distincts comptent.** Tous les participants doivent rester niveau 60. 1 600 à la cible; maximum 3 200. Preuves de parcours requises; couverture supplémentaire visible sans inflation."
    : "**Level 60: your best 8 distinct routes count.** All participants must remain level 60. 1,600 at target; maximum 3,200. Required route evidence must be recorded; extra coverage stays visible without inflation.");
  if (speed) lines.push(fr ? "Cibles figées pour la saison. 15 % plus rapide = +10 ; 30 % = +20. Sans cible : 100."
    : "Targets are fixed for the season. 15% faster = +10; 30% = +20. No target: 100.");
  for (const row of rows.slice(0, 10)) {
    const rank = rows.findIndex(other => other.points === row.points) + 1;
    const scoredDungeons = timed && row.details ? row.details.filter(d => d.points > 0).length : row.dungeons;
    const dungeonLabel = timed ? (fr ? "donjon(s) classé(s)" : "ranked dungeon(s)") : (fr ? "donjon(s)" : "dungeon(s)");
    lines.push(`${rank === 1 ? "🏅" : `${rank}.`} **${escapeMarkdown(row.name).slice(0, 100)}** · **${row.points}** · ${scoredDungeons} ${dungeonLabel}`);
  }
  if (!rows.length) lines.push(timed ? (fr ? "Terminez un donjon calibré pour établir votre score." : "Complete a calibrated dungeon to establish your score.") : fr ? "Le premier nouveau donjon admissible rapporte 100." : "Your first eligible new dungeon earns 100.");
  return new EmbedBuilder().setColor(0x8b5cf6).setTitle(`${fr ? "🏅 Exploration" : "🏅 Exploration rating"} · ${seasonName}`.slice(0, 256))
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: fr ? "Boss final détecté + présence ≥ 80 %. Points de participation séparés." : "Detected final boss + ≥80% presence. Participation points are separate." });
}

const rankLine = (rows: RatingRow[], row: RatingRow, fr: boolean) => {
  const rank = rows.findIndex(other => other.points === row.points) + 1;
  const scored = row.details ? row.details.filter(d => d.points > 0).length : row.dungeons;
  return `${rank === 1 ? "🏅" : `${rank}.`} **${escapeMarkdown(row.name).slice(0, 100)}** · **${row.points}** · ${scored} ${fr ? "parcours classé(s)" : "ranked route(s)"}`;
};
/** Shown while a provisional all-level season still has a route on its starting target. */
export const provisionalNote = (fr: boolean) => fr
  ? "⚠️ **Cibles provisoires** : des recommandations en attendant de vrais chronos. Un officier peut recalibrer un parcours d’après de vrais runs; les scores déjà obtenus gardent leur cible."
  : "⚠️ **Provisional targets**: recommendations until real timed runs exist. An officer may recalibrate a route from real runs; scores already earned keep their target.";
const bracketLabel = (b: DungeonBracket, fr: boolean) => b.min === b.max ? `${fr ? "Niveau" : "Level"} ${b.min}` : `${fr ? "Niveaux" : "Levels"} ${b.min}–${b.max}`;
// One bracket in full, or (no bracket chosen) the top five of every bracket.
function bracketRatingEmbed(rows: RatingRow[], seasonName: string, lang: Lang, rules: BracketedRules, key?: string): EmbedBuilder {
  const fr = lang === "fr";
  const chosen = rules.brackets.find(b => b.key === key);
  const lines = [fr ? "**Score de vitesse par tranche de niveaux · meilleure tentative par parcours**" : "**Dungeon-time rating by level bracket · best result per route**",
    fr ? "Arrondi(200 × cible ÷ durée), 50–400 par parcours. Chaque personnage est classé dans la tranche de son niveau pendant le run; tous les participants doivent rester dans la plage du parcours. Détails : `/dungeon rules`."
      : "Round(200 × target ÷ duration), 50–400 per route. Each character ranks in the bracket of their level during the run; every participant must stay inside the route's band. Details: `/dungeon rules`.",
    fr ? `Groupe au-dessus de la plage : −${rules.overlevelPenalty.percentPerLevel} % par niveau du plus haut participant, jusqu’à ${rules.overlevelPenalty.maxLevels} niveaux; au-delà, transport : 0.`
      : `Group above the band: −${rules.overlevelPenalty.percentPerLevel}% per level of the highest participant, up to ${rules.overlevelPenalty.maxLevels} levels; beyond that it is a carry: 0.`];
  if (rules.provisionalTargets) lines.unshift(provisionalNote(fr));
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setFooter({ text: fr ? "Boss final détecté + présence ≥ 80 %. Points de participation séparés." : "Detected final boss + ≥80% presence. Participation points are separate." });
  if (chosen) {
    const own = rows.filter(row => row.bracket === chosen.key);
    lines.push(fr ? `**${bracketLabel(chosen, true)} : vos ${chosen.bestCount} meilleurs parcours distincts comptent.**` : `**${bracketLabel(chosen, false)}: your best ${chosen.bestCount} distinct routes count.**`);
    lines.push(...own.slice(0, 10).map(row => rankLine(own, row, fr)));
    if (!own.length) lines.push(fr ? "Terminez un parcours calibré de cette tranche pour établir votre score." : "Complete a calibrated route in this bracket to establish your score.");
    return embed.setTitle(`🏅 ${bracketLabel(chosen, fr)} · ${seasonName}${rules.provisionalTargets ? fr ? " · provisoire" : " · provisional" : ""}`.slice(0, 256)).setDescription(lines.join("\n\n").slice(0, 4096));
  }
  for (const b of rules.brackets) {
    const own = rows.filter(row => row.bracket === b.key);
    embed.addFields({ name: `${bracketLabel(b, fr)} · ${fr ? `${b.bestCount} meilleurs` : `best ${b.bestCount}`}`,
      value: (own.length ? own.slice(0, 5).map(row => rankLine(own, row, fr)).join("\n") : fr ? "Aucun score." : "No scores yet.").slice(0, 1024) });
  }
  lines.push(fr ? "Une tranche : `/dungeon leaderboard bracket:`." : "One bracket: `/dungeon leaderboard bracket:`.");
  return embed.setTitle(`${fr ? "🏅 Exploration" : "🏅 Exploration rating"} · ${seasonName}${rules.provisionalTargets ? fr ? " · provisoire" : " · provisional" : ""}`.slice(0, 256)).setDescription(lines.join("\n\n"));
}

export interface DungeonCatalogEntry {
  dungeonKey: string; instanceId: number; name: string; targetSec: number | null;
  minLevel?: number; maxLevel?: number; provisional?: boolean; bracket?: string;
}
export function seasonDungeonCatalog(rules: unknown, rows: RatingRow[]): DungeonCatalogEntry[] {
  const result = new Map<string, DungeonCatalogEntry>();
  const bracketed = validBracketedRules(rules);
  const november = bracketed || validNovemberRules(rules);
  const catalog = bracketed ? rules.catalog : november ? rules.routes.filter(r => r.targetSec !== null).map(r => ({ dungeonKey: r.dungeonKey, instanceId: r.instanceId, name: r.name, targetSec: r.targetSec, minLevel: 60, maxLevel: 60 })) : (rules as { catalog?: unknown[] } | null)?.catalog;
  for (const raw of Array.isArray(catalog) ? catalog.slice(0, 100) : []) {
    const d = raw as DungeonCatalogEntry;
    if (!d || typeof d.dungeonKey !== "string" || !(november ? novemberDungeonKey(d.dungeonKey) : validDungeonKey(d.dungeonKey)) || Number(d.dungeonKey.split(":")[0]) !== d.instanceId
      || typeof d.name !== "string" || !Number.isInteger(d.targetSec) || d.targetSec! <= 0 || d.targetSec! > 14400) continue;
    result.set(d.dungeonKey, { ...d });
  }
  for (const row of rows) for (const detail of row.details ?? []) {
    const key = detail.dungeonKey ?? String(detail.instanceId);
    result.set(key, { dungeonKey: key, instanceId: detail.instanceId, name: detail.name, targetSec: detail.targetSec,
      ...result.get(key) });
  }
  return [...result.values()];
}
