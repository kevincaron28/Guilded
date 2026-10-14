import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import type { Lang } from "../i18n.js";

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
  const wings = [
    ["graveyard", ["bloodmage thalnos", "mage de sang thalnos"]],
    ["library", ["arcanist doan", "arcaniste doan"]],
    ["armory", ["herod", "hérode"]],
    ["cathedral", ["high inquisitor whitemane", "grande inquisitrice blanchetête"]]
  ] as const;
  const matches = wings.filter(([, bosses]) => bosses.some(name => names.has(name)));
  return matches.length === 1 ? `189:${matches[0]![0]}` : "189";
}
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
  const validTargets = !!rule["targets"] && typeof rule["targets"] === "object" && !Array.isArray(rule["targets"])
    && Object.entries(rule["targets"]).every(([id, seconds]) => validDungeonKey(id)
      && typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 1 && seconds <= 14400);
  const version = rule["version"] === 1 && rule["speedBonus"] === 0 && rule["pointsPerDungeon"] === 100
    || rule["version"] === 2 && rule["pointsPerDungeon"] === 100 && rule["speedBonus"] === 20 && rule["fullBonusFasterFraction"] === 0.3 && validTargets
    || rule["version"] === 3 && rule["pointsPerDungeon"] === 200 && rule["speedBonus"] === 0
      && !!rule["levelBands"] && typeof rule["levelBands"] === "object" && !Array.isArray(rule["levelBands"])
      && Object.entries(rule["levelBands"]).every(([id, b]) => validDungeonKey(id) && validLevelBand(b))
      && rule["minimumScore"] === 50 && rule["maximumScore"] === 400 && validTargets;
  return version && rule["model"] === "distinct-dungeons"
    && rule["minimumPresence"] === 0.8 && rule["automaticCompletionOnly"] === true;
}
export interface DungeonRatingDetail {
  instanceId: number; name: string; points: number; speedBonus: number; durationSec: number;
  targetSec: number | null; runRef: string; dungeonKey?: string; ratingVersion?: 3; unrankedReason?: string; bosses?: BossRecord[];
}
export interface RatingRow { memberId: string; character?: string; name: string; points: number; dungeons: number; details?: DungeonRatingDetail[] }
// Runs retain the actual character name. Keep the owner for membership and
// permissions, but never use their account alone as the competitive identity.
// Scoped to one guild by dungeonRating; Forever realm labels are not stable.
export function ratingCharacterKey(memberId: string, character: string): string {
  return JSON.stringify([memberId, character.trim().toLowerCase()]);
}
export interface BossRecord { id: number; name: string; durationSec: number; runRef: string }
export interface RatingRun {
  competitionData?: unknown; difficultyId?: number; startedAt?: Date | null; endedAt?: Date | null;
  instanceId: number; durationSec: number | null; dungeonName?: string; runRef?: string;
  players: { character?: string; memberId: string | null; presentSec: number; member: { displayName: string } | null }[];
}
export function speedPoints(seconds: number, target: number | null): number {
  return target ? Math.round(20 * Math.max(0, Math.min(1, (target - seconds) / (0.3 * target)))) : 0;
}
// A target is a benchmark, not a completion reward. Uncalibrated runs stay visible at zero.
export function timeRating(seconds: number, target: number | null): number {
  return target && seconds > 0 ? Math.max(50, Math.min(400, Math.round(200 * target / seconds))) : 0;
}
export function competitionReason(run: RatingRun, band: LevelBand | undefined): string | undefined {
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
  if (data.players.some(p => p.level! > band.max)) return "Overlevel carry";
  if (data.players.some(p => p.minLevel! < band.min)) return "Below level range";
  return undefined;
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
  const targets = version === 2 || version === 3
    ? (rules as ReturnType<typeof createDungeonRatingRules>).targets : {};
  const members = new Map<string, { memberId: string; name: string; bests: Map<string, DungeonRatingDetail> }>();
  for (const run of runs) {
    if (!run.durationSec || !Number.isFinite(run.durationSec) || run.durationSec <= 0) continue;
    const key = version === 3 ? ratingDungeonKey(run) : String(run.instanceId);
    const reason = version === 3 && key === "189" ? "Dungeon route unknown" : version === 3 ? competitionReason(run, (rules as { levelBands?: Record<string, LevelBand> }).levelBands?.[key]) : undefined;
    const bosses = version === 3 && !reason && targets[key] ? bossRecords(run) : [];
    for (const player of run.players) {
      if (!player.memberId || !player.member || !player.character?.trim() || !Number.isFinite(player.presentSec) || player.presentSec < run.durationSec * 0.8) continue;
      const identity = ratingCharacterKey(player.memberId, player.character);
      const member = members.get(identity) ?? { memberId: player.memberId, name: player.character.trim(), bests: new Map<string, DungeonRatingDetail>() };
      const targetSec = targets[key] ?? null;
      const speedBonus = version === 3 ? 0 : speedPoints(run.durationSec, targetSec);
      const detail: DungeonRatingDetail = { ...(version === 3 ? { ratingVersion: 3 as const, dungeonKey: key, ...(reason || !targetSec ? { unrankedReason: reason ?? "Target not calibrated" } : {}), bosses: [] } : {}), instanceId: run.instanceId, name: key.startsWith("189:") ? `Scarlet Monastery: ${key.split(":")[1]}` : run.dungeonName ?? `#${run.instanceId}`, points: version === 3 ? reason ? 0 : timeRating(run.durationSec, targetSec) : 100 + speedBonus,
        speedBonus, durationSec: run.durationSec, targetSec, runRef: run.runRef ?? "" };
      const previous = member.bests.get(key);
      const bossBests = new Map((previous?.bosses ?? []).map(b => [b.id, b]));
      for (const boss of bosses) if (!bossBests.has(boss.id) || boss.durationSec < bossBests.get(boss.id)!.durationSec) bossBests.set(boss.id, boss);
      if (version === 3) detail.bosses = [...bossBests.values()].sort((a, b) => a.id - b.id);
      if (previous && version === 3) previous.bosses = detail.bosses ?? [];
      if (!previous || detail.points > previous.points || detail.points === previous.points
        && (detail.durationSec < previous.durationSec || detail.durationSec === previous.durationSec && detail.runRef < previous.runRef)) {
        member.bests.set(key, detail);
      }
      members.set(identity, member);
    }
  }
  return [...members.values()].map(member => ({ memberId: member.memberId, character: member.name, name: member.name,
    points: [...member.bests.values()].reduce((sum, best) => sum + best.points, 0), dungeons: member.bests.size,
    ...(rules !== undefined ? { details: [...member.bests.values()].sort((a, b) => a.instanceId - b.instanceId) } : {}) }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId));
}
function validDetails(row: RatingRow): boolean {
  if (!Array.isArray(row.details) || row.details.length !== row.dungeons) return false;
  const ids = new Set<string>();
  let total = 0;
  for (const detail of row.details) {
    const key = detail?.dungeonKey ?? String(detail?.instanceId);
    if (!detail || !Number.isInteger(detail.instanceId) || detail.instanceId <= 0 || ids.has(key) || !validDungeonKey(key) || Number(key.split(":")[0]) !== detail.instanceId
      || typeof detail.name !== "string" || typeof detail.runRef !== "string" || !Number.isFinite(detail.durationSec) || detail.durationSec <= 0
      || !Number.isInteger(detail.speedBonus) || detail.speedBonus < 0 || detail.speedBonus > 20
      || detail.targetSec !== null && (!Number.isInteger(detail.targetSec) || detail.targetSec < 1 || detail.targetSec > 14400)) return false;
    if (detail.ratingVersion === 3) {
      if (detail.speedBonus !== 0 || detail.points !== (detail.unrankedReason ? 0 : timeRating(detail.durationSec, detail.targetSec))) return false;
      if (detail.unrankedReason !== undefined && !["Level range not configured", "Different difficulty", "Party levels unknown", "Overlevel carry", "Below level range", "Target not calibrated", "Dungeon route unknown"].includes(detail.unrankedReason)) return false;
      if (detail.bosses !== undefined && (!Array.isArray(detail.bosses) || detail.bosses.length > 100
        || new Set(detail.bosses.map(b => b.id)).size !== detail.bosses.length
        || detail.bosses.some(b => !Number.isInteger(b.id) || b.id <= 0 || !Number.isInteger(b.durationSec) || b.durationSec <= 0
          || b.durationSec > 14400 || typeof b.name !== "string" || typeof b.runRef !== "string"))) return false;
    } else if (detail.ratingVersion !== undefined || detail.points !== 100 + detail.speedBonus
      || detail.speedBonus !== speedPoints(detail.durationSec, detail.targetSec)) return false;
    ids.add(key); total += detail.points;
  }
  return total === row.points;
}
export function frozenRating(value: unknown): RatingRow[] | null {
  if (!Array.isArray(value) || value.some(row => !row || typeof row.memberId !== "string" || typeof row.name !== "string"
    || (row.character !== undefined && (typeof row.character !== "string" || !row.character.trim() || row.name !== row.character))
    || !Number.isInteger(row.points) || row.points < 0 || !Number.isInteger(row.dungeons) || row.dungeons < 0
    || (row.details === undefined ? row.points !== row.dungeons * 100 : !validDetails(row)))) return null;
  return value as RatingRow[];
}
export async function dungeonRating(database: Pick<PrismaClient, "dungeonRun">, guildId: string,
  season: { id: string; startsAt: Date; endsAt?: Date | null; status: string; ratingRules?: unknown; finalRating?: unknown }, instanceId: number | null = null): Promise<RatingRow[]> {
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
  const timed = (season.ratingRules as { version: number }).version === 3;
  const runs = await database.dungeonRun.findMany({ where: {
    guildId, seasonId: season.id, valid: true, state: "COMPLETED", completedBy: "final boss",
    durationSec: { gt: 0 }, NOT: { runRef: { startsWith: "SIM-" } },
    startedAt: { gte: season.startsAt }, ...(season.endsAt ? { endedAt: { lt: season.endsAt } } : {}),
    ...(instanceId !== null ? { instanceId } : {})
  }, select: { competitionData: true, difficultyId: true, startedAt: true, endedAt: true, instanceId: true, dungeonName: true, runRef: true, durationSec: true, players: {
    ...(!timed ? { where: { member: { guildId } } } : {}),
    select: { character: true, memberId: true, presentSec: true, member: { select: { displayName: true, guildId: true } } }
  } } });
  return calculateDungeonRating(timed ? runs.map(run => ({ ...run, players: run.players.map(p => ({ ...p,
    member: p.member?.guildId === guildId ? p.member : null })) })) : runs, season.ratingRules);
}
export function ratingEmbed(rows: RatingRow[], seasonName: string, lang: Lang, rules: unknown = DUNGEON_RATING_RULES): EmbedBuilder {
  const fr = lang === "fr";
  const speed = hasDungeonRating(rules) && (rules as { version: number }).version === 2;
  const timed = hasDungeonRating(rules) && (rules as { version: number }).version === 3;
  const lines = [timed ? (fr ? "**Score de vitesse · meilleure tentative par donjon**" : "**Dungeon-time rating · best result per dungeon**") : speed ? (fr ? "**100 par donjon distinct + 0–20 de vitesse · meilleure tentative seulement**" : "**100 per distinct dungeon + 0–20 speed · best result only**")
    : fr ? "**100 par donjon distinct · aucun bonus de vitesse**" : "**100 per distinct dungeon · no speed bonus**",
    rows.some(row => row.character === undefined)
      ? (fr ? "Archive par compte : les alts partagent le résultat enregistré." : "Account-based archive: alts share the recorded result.")
      : (fr ? "Score par personnage : chaque alt a ses propres meilleurs parcours. Les égalités partagent le rang."
        : "Per-character rating: each alt has its own best runs. Equal ratings share a rank.")];
  if (timed) lines.push(fr ? "200 à la cible, 50–400 par donjon. Cibles figées. Sans cible : calibration, 0 point."
    : "200 at target, 50–400 per dungeon. Fixed targets. No target: calibrating, 0 points.");
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

export interface DungeonCatalogEntry {
  dungeonKey: string; instanceId: number; name: string; targetSec: number | null;
  minLevel?: number; maxLevel?: number; provisional?: boolean;
}
export function seasonDungeonCatalog(rules: unknown, rows: RatingRow[]): DungeonCatalogEntry[] {
  const result = new Map<string, DungeonCatalogEntry>();
  const catalog = (rules as { catalog?: unknown[] } | null)?.catalog;
  for (const raw of Array.isArray(catalog) ? catalog.slice(0, 100) : []) {
    const d = raw as DungeonCatalogEntry;
    if (!d || typeof d.dungeonKey !== "string" || !validDungeonKey(d.dungeonKey) || Number(d.dungeonKey.split(":")[0]) !== d.instanceId
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
