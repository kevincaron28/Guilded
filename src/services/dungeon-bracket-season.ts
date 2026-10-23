import { EmbedBuilder } from "discord.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import { startSeason } from "./dungeon-admin.js";
import { BRACKET_PLAN, type PlannedRoute } from "./dungeon-bracket-plan.js";
import { novemberDungeonCatalog } from "./dungeon-november-catalog.js";
import {
  DEFAULT_DUNGEON_BRACKETS, createBracketedDungeonRules, resolveNovemberRoute, validBracketedRules, type BracketRoute, type BracketedRules
} from "./dungeon-november-rules.js";
import { SCARLET_WINGS, competitionReason } from "./dungeon-rating.js";
import { formatDuration } from "./dungeon-rules.js";
import { CALIBRATION_POLICY, calibrationSample } from "./dungeon-calibration.js";

// Officer flow for a PROVISIONAL all-level season (roadmap item 3; owner, 18 October 2026: "use
// provisional recommendations until real timed runs exist"). It turns the plan in
// dungeon-bracket-plan.ts into version 6 rules using only what the addon observes today:
// - map IDs and Scarlet wings that real beta-client runs reported (BETA_DUNGEONS; map 189 for
//   Armory and Cathedral, whose wing is told apart by boss name like the other two);
// - difficulty 0, the value the beta client reported in real exported runs
//   (docs/DUNGEON_BETA_PRESET_2026-10.md);
// - completion when the addon detects the final boss from the Encounter Journal (the beta seasons'
//   rule), or for a Scarlet wing its last boss by name.
// Planned routes with no observed map ID are left out and listed as waiting; a bracket left with
// fewer rated routes than its best-N is left out too. Nothing here invents IDs or timers.
export const PROVISIONAL_PLAN_ID = "bracket-plan-2026-10-18";
const OBSERVED_DIFFICULTY = 0;
export const MIN_RECALIBRATION_RUNS = CALIBRATION_POLICY.samples;
const NO_MAP = "No map ID observed yet (not in the beta client)";

function provisionalRoute(plan: PlannedRoute, name: string): BracketRoute {
  const [map, wing] = plan.mapKey!.split(":");
  const bosses = wing ? SCARLET_WINGS.find(([w]) => w === wing)?.[1] : undefined;
  if (wing && !bosses) throw new Error(`Unknown Scarlet wing ${plan.mapKey}`);
  const band = { min: plan.min, max: plan.max, difficultyId: OBSERVED_DIFFICULTY };
  return {
    dungeonKey: plan.mapKey!, instanceId: Number(map), name,
    completion: { ids: [], names: bosses ? [...bosses] : [] }, requiredEncounters: [],
    ...(bosses ? {} : { completionModel: "addon-final-boss" as const }),
    routeStandard: bosses ? "Last boss of the wing, by name, inside the run" : "Final boss detected by the addon (Encounter Journal)",
    participationBand: band, competitionBand: { ...band }, targetSec: plan.minutes * 60,
    verification: { build: "provisional", runRef: PROVISIONAL_PLAN_ID }
  };
}

/** The provisional season the plan allows today, with what had to wait. Pure; no database. */
export function provisionalSeasonRules(plan: readonly PlannedRoute[] = BRACKET_PLAN) {
  const names = new Map(novemberDungeonCatalog().routes.map(r => [r.id, r.name]));
  const observed = plan.filter(r => r.mapKey);
  const brackets = DEFAULT_DUNGEON_BRACKETS.filter(b => observed.filter(r => r.bracket === b.key).length >= b.bestCount).map(b => ({ ...b }));
  const left = DEFAULT_DUNGEON_BRACKETS.filter(b => !brackets.some(x => x.key === b.key)).map(b => ({ ...b }));
  const included = observed.filter(r => brackets.some(b => b.key === r.bracket));
  const waiting = plan.filter(r => !included.includes(r)).map(r => ({ id: r.id,
    reason: r.mapKey ? `Bracket ${r.bracket} is not in this season` : NO_MAP }));
  const rules = createBracketedDungeonRules({ routes: included.map(r => provisionalRoute(r, names.get(r.id) ?? r.id)), brackets,
    provisional: { plan: PROVISIONAL_PLAN_ID, waiting } });
  return { rules, plan: included, waiting, leftOut: left };
}

const levels = (min: number, max: number) => min === max ? `${min}` : `${min}–${max}`;

/** Officer preview: every bracket, its routes, levels, targets and best-N, all marked provisional. */
export function provisionalSeasonEmbed(): EmbedBuilder {
  const { rules, plan, waiting, leftOut } = provisionalSeasonRules();
  const names = new Map(novemberDungeonCatalog().routes.map(r => [r.id, r.name]));
  const p = rules.overlevelPenalty;
  const embed = new EmbedBuilder().setColor(0xf59e0b)
    .setTitle("All-level season · PROVISIONAL preview")
    .setDescription([
      "**Every target below is provisional**: a recommendation (plan of 18 October 2026) until real timed runs exist. During the season, `/officer dungeon recalibrate` replaces a route's target from at least 3 real timed runs; scores already earned keep their target.",
      `Map IDs and difficulty ${OBSERVED_DIFFICULTY} come from real beta-client runs. A run completes when the addon detects the final boss (Scarlet wings: their last boss by name). Above a route's levels: −${p.percentPerLevel}% per level, up to ${p.maxLevels}; beyond: 0.`,
      "Start: seasons follow the Guilded owner's calendar (`/organize dungeon-seasons preview`); these rules start with Season 1 on 4 November."
    ].join("\n\n"));
  for (const b of rules.brackets) {
    const rows = plan.filter(r => r.bracket === b.key);
    embed.addFields({ name: `Levels ${levels(b.min, b.max)} · best ${b.bestCount} of ${rows.length} · provisional`,
      value: rows.map(r => `${names.get(r.id) ?? r.id} · ${levels(r.min, r.max)} · ${r.minutes} min${r.source === "estimate" ? " (estimate)" : " (beta)"}`).join("\n").slice(0, 1024) });
  }
  for (const b of leftOut) {
    const rows = waiting.filter(w => BRACKET_PLAN.find(r => r.id === w.id)?.bracket === b.key);
    embed.addFields({ name: `Levels ${levels(b.min, b.max)} · NOT in this season`,
      value: (`No rating for characters at these levels until launch data exists (${NO_MAP.toLowerCase()}). Waiting: `
        + rows.map(w => names.get(w.id) ?? w.id).join(", ")).slice(0, 1024) });
  }
  const inside = waiting.filter(w => rules.brackets.some(b => BRACKET_PLAN.find(r => r.id === w.id)?.bracket === b.key));
  if (inside.length) embed.addFields({ name: "Waiting for launch data (not rated)", value: inside.map(w => `${names.get(w.id) ?? w.id}: ${w.reason}`).join("\n").slice(0, 1024) });
  return embed.setFooter({ text: `Provisional · ${PROVISIONAL_PLAN_ID} · nothing has started` });
}

type SeasonDb = Parameters<typeof startSeason>[0];
const MAX_SEASON_MS = 366 * 86400000;

/** Starts the provisional season through the normal archived, transactional rotation. */
export async function startProvisionalSeason(database: SeasonDb, guildId: string,
  input: { name: string; startsAt: Date; endsAt: Date; rotate: boolean }, now = new Date()) {
  const { startsAt, endsAt } = input;
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) throw new Error("Give starts_at and ends_at with a time zone, e.g. 2026-10-19T20:00:00-04:00.");
  if (startsAt.getTime() < now.getTime() - 10 * 60000) throw new Error("starts_at is in the past; runs already imported belong to the current season.");
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > MAX_SEASON_MS) throw new Error("ends_at must be after starts_at, at most one year later.");
  const active = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (active && !input.rotate) throw new Error(`**${active.name}** is active. Nothing changed. Run again with rotate:true to archive it (standings frozen, runs and points kept) and start this season.`);
  const { rules } = provisionalSeasonRules();
  const result = await startSeason(database, guildId, input.name, active?.id ?? null, endsAt, rules, startsAt);
  return { ...result, rules };
}

type EvidenceDb = Pick<PrismaClient, "dungeonSeason" | "dungeonRun">;

/** Real ranked timed runs on one route of the active provisional season, and a suggested target. */
export async function recalibrationEvidence(database: EvidenceDb, guildId: string, key: string) {
  const season = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (!season || !validBracketedRules(season.ratingRules) || !season.ratingRules.provisional) {
    throw new Error("No provisional all-level season is active. Other seasons keep fixed targets: a new target waits for the next season.");
  }
  const rules: BracketedRules = season.ratingRules;
  const route = rules.routes.find(r => r.dungeonKey === key && r.targetSec !== null);
  if (!route) throw new Error("Pick a rated route of the current season from the list.");
  const runs = await database.dungeonRun.findMany({ where: { guildId, seasonId: season.id, instanceId: route.instanceId, valid: true,
    state: "COMPLETED", completedBy: "final boss", durationSec: { gt: 0 }, NOT: { runRef: { startsWith: "SIM-" } },
    startedAt: { gte: season.startsAt }, ...(season.endsAt ? { endedAt: { lt: season.endsAt } } : {}) },
  select: { runRef: true, competitionData: true, difficultyId: true, startedAt: true, endedAt: true, completedBy: true, instanceId: true, durationSec: true,
    players: { select: { character: true, memberId: true, presentSec: true } } } });
  // Only runs inside the route's own levels (no over-level groups) calibrate it.
  const band = rules.levelBands[key];
  const eligible = runs.filter(run => {
    const resolved = resolveNovemberRoute(run, rules);
    return resolved.key === key && !resolved.reason
      && competitionReason({ ...run, players: run.players.map(p => ({ ...p, member: null })) }, band) === undefined;
  });
  const sample = calibrationSample(eligible.filter(run => run.endedAt && run.players.every(p => p.presentSec >= 0.8 * run.durationSec!)).map(run => {
    const metadata = run.competitionData as { gameBuild?: string; startTrigger?: string } | null;
    return { id: run.runRef, seconds: run.durationSec!, endedAt: run.endedAt!,
      crew: run.players.map(p => p.memberId ? `member:${p.memberId}` : `character:${p.character.trim().toLowerCase()}`),
      build: typeof metadata?.gameBuild === "string" ? metadata.gameBuild : null,
      startTrigger: typeof metadata?.startTrigger === "string" ? metadata.startTrigger : null };
  }));
  const { median } = sample;
  const minutes = median === null ? null : Math.round(median / 60);
  const suggestedMinutes = minutes !== null && minutes >= 5 && minutes <= 120 ? minutes : null;
  return { season, rules, route, currentSec: rules.targets[key]!, provisional: !(rules.recalibrations ?? []).some(c => c.dungeonKey === key),
    ...sample, ready: sample.ready && suggestedMinutes !== null, suggestedMinutes };
}

export function describeEvidence(e: Awaited<ReturnType<typeof recalibrationEvidence>>): string {
  return [`**${e.route.name}** · target ${formatDuration(e.currentSec)}${e.provisional ? " (provisional)" : " (recalibrated)"}`,
    `${e.times.length} crew/day samples from ${e.comparableRuns} comparable runs, ${e.crews} crews, ${e.days} UTC days. Build: ${e.build ?? "unknown"}; first-combat starts only. ${e.excludedRuns} excluded (build/start/party metadata).`,
    e.times.length ? `Median ${formatDuration(e.median!)}; middle 50% ${formatDuration(e.p25!)}–${formatDuration(e.p75!)}. This spread is not a confidence interval.` : "No comparable sample yet.",
    e.median !== null && e.suggestedMinutes === null ? "The rounded median is outside the supported 5–120 minute target range. Nothing can be applied; review the route and sample."
      : e.ready ? `Suggested target: **${e.suggestedMinutes} min** (crew/day median). Only this target can be applied with \`minutes:\`.`
      : `${MIN_RECALIBRATION_RUNS} are needed, with at least ${CALIBRATION_POLICY.crews} substantially different crews and ${CALIBRATION_POLICY.days} days; the target stays provisional.`].join("\n");
}

/** Replaces a route's target for runs ending from now on; earlier runs keep the target they earned under. */
export async function recalibrateRoute(database: Pick<PrismaClient, "$transaction">, guildId: string, key: string, minutes: number, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new Error("Minutes must be a whole number from 5 to 120.");
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    const e = await recalibrationEvidence(tx, guildId, key);
    if (!e.ready) throw new Error(`Nothing changed. ${describeEvidence(e)}`);
    if (minutes !== e.suggestedMinutes) throw new Error(`Nothing changed. Use the reviewed crew/day median: ${e.suggestedMinutes} min. Other targets wait for a new season.`);
    const targetSec = minutes * 60;
    if (targetSec === e.currentSec) throw new Error(`The target is already ${minutes} min.`);
    const rules = createBracketedDungeonRules({ routes: e.rules.routes, brackets: e.rules.brackets, overlevelPenalty: e.rules.overlevelPenalty,
      provisional: e.rules.provisional, recalibrations: [...(e.rules.recalibrations ?? []), { dungeonKey: key, targetSec, from: now.toISOString(), runs: e.times.length }] });
    await tx.dungeonSeason.update({ where: { id: e.season.id }, data: { ratingRules: rules as unknown as Prisma.InputJsonValue } });
    return { ...e, beforeSec: e.currentSec, afterSec: targetSec, from: now, rules };
  });
}

/** Autocomplete: rated routes of the active season, provisional ones marked. */
export async function routeChoices(database: Pick<PrismaClient, "dungeonSeason">, guildId: string, query: string) {
  const season = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (!season || !validBracketedRules(season.ratingRules)) return [];
  const needle = query.trim().toLowerCase();
  return season.ratingRules.catalog.filter(d => !needle || d.name.toLowerCase().includes(needle) || d.dungeonKey.includes(needle)).slice(0, 25)
    .map(d => ({ name: `${d.name} · ${levels(d.minLevel, d.maxLevel)} · ${formatDuration(d.targetSec)}${d.provisional ? " · provisional" : ""}`.slice(0, 100), value: d.dungeonKey }));
}
