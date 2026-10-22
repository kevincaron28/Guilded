import { bracketForLevel, resolveNovemberRoute, validBracketedRules, validRouteRules } from "./dungeon-november-rules.js";
import type { Prisma } from "../generated/prisma/client.js";
import { grantRunAchievements, type AchievementKey } from "./dungeon-achievements.js";
import { findCharacter } from "./character-match.js";
import { competitionReason, completionReason, createDungeonRatingRules, dungeonRating, hasDungeonRating, ratingCharacterKey, type LevelBand } from "./dungeon-rating.js";
import { participationDungeonKey, participationMode, participationRecordEligible, type ParticipationRun } from "./dungeon-participation.js";
import {
  computeRunPoints, computeWeeklyVarietyPoints, dungeonConfig, dungeonRunSchema, validateRun, weekStart,
  type DungeonRunInput, type PlayerContext
} from "./dungeon-rules.js";

// Turns dungeon runs from an addon import into stored runs and points
// (roadmap D3/D4). Every run is handled on its own: a malformed or invalid
// run is recorded/rejected without affecting the others, and the same run
// can never be counted twice (by run id, or by same dungeon + same players
// + start within 2 minutes when two members reported it separately).

type Tx = Pick<Prisma.TransactionClient, "dungeonRun" | "dungeonSeason" | "dungeonPointTransaction" | "guildSettings" | "dungeonAchievement">;

interface LinkedCharacter { name: string; realm: string; memberId: string; spec?: string | null }

export interface DungeonImportResult {
  runRef: string;
  dungeonName: string;
  difficultyId: number;
  state: string;
  valid: boolean;
  invalidReason?: string;
  durationSec: number | null;
  points: number;
  guildRecord: boolean;
  previousGuildBest: number | null;
  personalRecords: { character: string; previous: number; now: number }[];
  players: string[];
  // Sum of tracked deaths; null when no player's deaths were tracked.
  deaths: number | null;
  endedAt?: number;
  startedAt?: number;
  encounters?: DungeonRunInput["encounters"];
  completedBy?: string;
  ratingEnabled?: boolean;
  ratingSpeedBonus?: number;
  ratingVersion?: number;
  playerDetails?: { character: string; class?: string; role?: string; spec?: string; specSource?: "run" | "profile"; deaths: number | null; presentSec: number; points: number; ratingGain?: number; ratingTotal?: number; unrankedReason?: string; participationRecipient?: string; participationMode?: "none" | "completion" | "helper" | "full" }[];
  unlinked: string[];
  achievements: { character: string; key: AchievementKey }[];
}

export interface DungeonImportSummary {
  results: DungeonImportResult[];
  duplicates: number;
  malformed: number;
}

const NEAR_DUPLICATE_SECONDS = 120;

export async function activeSeason(tx: Pick<Prisma.TransactionClient, "dungeonSeason">, guildId: string, targets: Record<string, number> = {}, bands: Record<string, LevelBand> = {}) {
  const current = await tx.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (current) return current;
  return tx.dungeonSeason.create({ data: { guildId, name: "Season 1", ratingRules: createDungeonRatingRules(targets, 3, bands) } });
}

async function isNearDuplicate(tx: Tx, guildId: string, run: DungeonRunInput): Promise<boolean> {
  if (!run.startedAt) return false;
  const start = new Date(run.startedAt * 1000);
  const candidates = await tx.dungeonRun.findMany({
    where: {
      guildId, instanceId: run.instanceId,
      startedAt: { gte: new Date(start.getTime() - NEAR_DUPLICATE_SECONDS * 1000), lte: new Date(start.getTime() + NEAR_DUPLICATE_SECONDS * 1000) }
    },
    include: { players: true }
  });
  const names = new Set(run.players.map((player) => player.character.toLowerCase()));
  return candidates.some((candidate) => {
    const shared = candidate.players.filter((player) => names.has(player.character.toLowerCase())).length;
    return shared >= Math.ceil(Math.max(names.size, candidate.players.length) * 0.6);
  });
}

export async function importDungeonRuns(
  tx: Tx,
  guildId: string,
  rawRuns: unknown[],
  characters: LinkedCharacter[],
  appliedBy: string,
  importId: string | null,
  now = new Date()
): Promise<DungeonImportSummary> {
  const summary: DungeonImportSummary = { results: [], duplicates: 0, malformed: 0 };
  if (rawRuns.length === 0) return summary;
  const settings = await tx.guildSettings.findUnique({ where: { guildId } });
  const config = dungeonConfig(settings?.dungeonConfig);
  const season = await activeSeason(tx, guildId, config.targets, config.levelBands);
  const rated = hasDungeonRating(season.ratingRules);
  const timed = rated && (season.ratingRules as { version: number }).version >= 3;
  const november = validRouteRules(season.ratingRules) ? season.ratingRules : undefined;
  const brackets = validBracketedRules(season.ratingRules) ? season.ratingRules.brackets : undefined;
  const overlevelAllowance = validBracketedRules(season.ratingRules) ? season.ratingRules.overlevelPenalty.maxLevels : 0;
  const ruleVersion = (season.ratingRules as { version?: number } | null)?.version;
  if ((ruleVersion === 5 || ruleVersion === 6) && !november) throw new Error("Invalid November rules; import refused without awards");
  const bestEight = rated && ((season.ratingRules as { version: number }).version === 4 || november !== undefined);
  const ratingRules = season.ratingRules as unknown as { targets: Record<string, number>; levelBands: Record<string, LevelBand>; participationLevelBands: Record<string, LevelBand> };
  const participationRules = bestEight ? { targets: {}, levelBands: ratingRules.participationLevelBands } : timed ? season.ratingRules as unknown as { targets: Record<string, number>; levelBands: Record<string, LevelBand> } : config;
  let previousRating = rated ? await dungeonRating(tx, guildId, season) : [];

  // Oldest first, so records and "earlier this week" are judged in order.
  const parsed = rawRuns.map((raw) => dungeonRunSchema.safeParse(raw));
  summary.malformed = parsed.filter((result) => !result.success).length;
  const runs = parsed.filter((result) => result.success).map((result) => result.data)
    .sort((a, b) => (a.endedAt ?? a.startedAt ?? 0) - (b.endedAt ?? b.startedAt ?? 0));

  for (const run of runs) {
    const existing = await tx.dungeonRun.findUnique({ where: { guildId_runRef: { guildId, runRef: run.id } } });
    if (existing || await isNearDuplicate(tx, guildId, run)) {
      summary.duplicates++;
      continue;
    }
    const check = validateRun(run, now);
    const durationSec = run.startedAt && run.endedAt ? run.endedAt - run.startedAt : null;
    const linked = run.players.map((player) => ({
      player,
      character: findCharacter(characters, player.character, player.realm)
    }));
    const evidence: ParticipationRun = {
      instanceId: run.instanceId, difficultyId: run.difficultyId, durationSec,
      startedAt: run.startedAt ? new Date(run.startedAt * 1000) : null, endedAt: run.endedAt ? new Date(run.endedAt * 1000) : null,
      completedBy: run.completedBy ?? run.endReason ?? null,
      competitionData: { players: run.players.map(p => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null })), encounters: run.encounters ?? [] },
      players: linked.map(({ player, character }) => ({ character: player.character, memberId: character?.memberId ?? null, presentSec: player.presentSec }))
    };
    const dungeonKey = participationDungeonKey(evidence, november);
    const novemberReason = november ? resolveNovemberRoute(evidence, november).reason : undefined;
    const band = participationRules.levelBands[dungeonKey];
    const recordEligible = participationRecordEligible(evidence, band, november);
    const inSeason = !!run.startedAt && run.startedAt * 1000 >= (season.startsAt?.getTime() ?? 0)
      && (!season.endsAt || !!run.endedAt && run.endedAt * 1000 < season.endsAt.getTime());
    const earnsPoints = (!bestEight || evidence.completedBy === "final boss" && !run.id.startsWith("SIM-")) && check.ok && run.state === "COMPLETED" && durationSec !== null && inSeason;

    // Records and history are judged BEFORE this run is saved.
    let guildRecord = false;
    let previousGuildBest: number | null = null;
    const contexts: PlayerContext[] = [];
    const personalRecords: DungeonImportResult["personalRecords"] = [];
    if (earnsPoints) {
      // Filter old evidence too: a historical carry must not block a fair record.
      const history = await tx.dungeonRun.findMany({
        where: { guildId, instanceId: run.instanceId, valid: true, state: "COMPLETED", durationSec: { not: null }, ...(bestEight ? { NOT: { runRef: { startsWith: "SIM-" } } } : {}) },
        select: { instanceId: true, difficultyId: true, durationSec: true, completedBy: true, competitionData: true,
          startedAt: true, endedAt: true, players: { select: { character: true, memberId: true, presentSec: true } } }
      });
      const routeHistory = history.filter(row => (!bestEight || row.completedBy === "final boss") && participationDungeonKey(row, november) === dungeonKey);
      const sameRoute = routeHistory.filter(row => row.endedAt
        && (bestEight ? row.endedAt.getTime() <= (run.endedAt ?? 0) * 1000 : row.endedAt.getTime() < (run.endedAt ?? 0) * 1000));
      const recordHistory = sameRoute.filter(row => participationRecordEligible(row, band, november));
      const best = recordEligible ? recordHistory.reduce<typeof recordHistory[number] | null>((best, row) =>
        !best || row.durationSec! < best.durationSec! ? row : best, null) : null;
      previousGuildBest = best?.durationSec ?? null;
      guildRecord = previousGuildBest !== null && durationSec < previousGuildBest;
      const weekFrom = weekStart(new Date((run.endedAt ?? 0) * 1000));
      // Guild Points belong to the account, even when multiple alts were recorded.
      // Choose the longest-present eligible character; names break equal-presence ties.
      const awardedAccounts = new Set<string>();
      for (const { player, character } of [...linked].sort((a, b) => b.player.presentSec - a.player.presentSec
        || a.player.character.localeCompare(b.player.character))) {
        if (!character) continue;
        const mode = participationMode(evidence, player.character, band, november);
        if (mode === "none" || awardedAccounts.has(character.memberId)) continue;
        awardedAccounts.add(character.memberId);
        const memberHistory = sameRoute.filter(row => row.players.some(p => p.memberId === character.memberId
          && participationMode(row, p.character, band, november) !== "none"));
        // Delayed uploads must consume the same weekly budget, even when newer
        // runs have already been imported. Legacy models retain their old order.
        const weeklyHistory = bestEight ? routeHistory.filter(row => row.endedAt && row.endedAt >= weekFrom
          && row.endedAt.getTime() < weekFrom.getTime() + 7 * 86400000
          && row.players.some(p => p.memberId === character.memberId && participationMode(row, p.character, band, november) !== "none"))
          : memberHistory.filter(row => row.endedAt && row.endedAt >= weekFrom);
        const sameDifficulty = mode === "full" ? recordHistory.filter(row => row.players.some(p => p.memberId === character.memberId
          && participationMode(row, p.character, band, november) === "full")) : [];
        const previousBest = sameDifficulty.length ? Math.min(...sameDifficulty.map((row) => row.durationSec as number)) : null;
        contexts.push({
          memberId: character.memberId,
          character: player.character,
          deaths: player.deaths,
          earlierThisWeek: weeklyHistory.length,
          firstEver: memberHistory.length === 0,
          previousBest, participationMode: mode
        });
        if (previousBest !== null && durationSec < previousBest) personalRecords.push({ character: player.character, previous: previousBest, now: durationSec });
      }
    }

    const stored = await tx.dungeonRun.create({
      data: {
        guildId,
        runRef: run.id,
        instanceId: run.instanceId,
        dungeonName: run.name,
        difficultyId: run.difficultyId,
        state: run.state,
        valid: check.ok,
        invalidReason: check.ok ? null : check.reason ?? "invalid",
        startedAt: run.startedAt ? new Date(run.startedAt * 1000) : null,
        endedAt: run.endedAt ? new Date(run.endedAt * 1000) : null,
        durationSec,
        completedBy: run.completedBy ?? run.endReason ?? null,
        recorder: run.recorder ?? null,
        reporterNames: run.reporterNames ?? [],
        competitionData: { players: run.players.map(p => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null })), encounters: run.encounters ?? [] },
        reporters: run.reporters,
        protocolVersion: run.protocolVersion,
        addonVersion: run.addonVersion ?? null,
        seasonId: season.id,
        importId,
        players: {
          create: linked.map(({ player, character }) => ({
            character: player.character,
            memberId: character?.memberId ?? null,
            class: player.class ?? null,
            role: player.role ?? null,
            deaths: player.deaths ?? null,
            presentSec: player.presentSec,
            inGuild: player.inGuild
          }))
        }
      }
    });

    let points = 0;
    const playerPoints = new Map<string, number>();
    let achievements: DungeonImportResult["achievements"] = [];
    if (earnsPoints) {
      const fullGuildGroup = run.players.length >= 5 && run.players.every((player) => player.inGuild);
      const target = participationRules.targets[dungeonKey];
      achievements = await grantRunAchievements(tx, guildId, { id: stored.id, seasonId: season.id }, contexts.filter(p => p.participationMode === "full"), {
        guildRecord,
        fullGuildGroup,
        underTarget: target !== undefined && durationSec <= target,
        deathless: run.players.every((player) => player.deaths === 0)
      }, config.dungeonMasterCount);
      const awards = (bestEight ? computeWeeklyVarietyPoints : computeRunPoints)({
        instanceId: run.instanceId,
        dungeonKey,
        durationSec,
        fullGuildGroup,
        guildRecord,
        players: contexts,
        config: { ...config, targets: participationRules.targets }
      });
      for (const award of awards) {
        await tx.dungeonPointTransaction.create({
          data: {
            guildId, memberId: award.memberId, runId: stored.id, seasonId: season.id,
            amount: award.amount, reason: `${award.reason} — ${run.name}`, source: `rule:${award.rule}`, createdBy: appliedBy
          }
        });
        points += award.amount;
        playerPoints.set(award.character, (playerPoints.get(award.character) ?? 0) + award.amount);
      }
    }

    const currentRating = rated ? await dungeonRating(tx, guildId, season) : [];
    // Version 6: the total of the bracket this character played in, by their level in this run.
    const routeBracket = validBracketedRules(season.ratingRules) ? season.ratingRules.routeBracket[dungeonKey] : undefined;
    const runBracket = (name: string) => routeBracket ?? bracketForLevel(brackets ?? [], run.players.find(p => p.character === name)?.level)?.key;
    const ratingFor = (rows: typeof currentRating, memberId: string, name: string) => rows.find(row => row.character
      && ratingCharacterKey(row.memberId, row.character) === ratingCharacterKey(memberId, name) && (!brackets || row.bracket === runBracket(name)))?.points ?? 0;
    summary.results.push({
      runRef: run.id,
      dungeonName: run.name,
      difficultyId: run.difficultyId,
      state: run.state,
      valid: check.ok,
      ...(check.ok ? {} : { invalidReason: check.reason ?? "invalid" }),
      durationSec,
      points,
      ...(rated ? { ratingEnabled: true, ratingVersion: (season.ratingRules as { version: number }).version, ratingSpeedBonus: (season.ratingRules as { speedBonus: number }).speedBonus } : {}),
      ...(run.endedAt ? { endedAt: run.endedAt } : {}),
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.encounters ? { encounters: run.encounters } : {}),
      ...(run.completedBy ? { completedBy: run.completedBy } : {}),
      playerDetails: linked.map(({ player, character }) => {
        const participationRecipient = contexts.find(p => p.memberId === character?.memberId)?.character;
        const unrankedReason = timed ? !check.ok ? check.reason ?? "Invalid run"
          : !inSeason ? "Outside season window"
          : run.id.startsWith("SIM-") ? "Simulation run"
          : completionReason(evidence.completedBy) !== undefined ? completionReason(evidence.completedBy)
          : novemberReason ? novemberReason
          : november && !ratingRules.targets[dungeonKey] ? "Participation-only route"
          : !november && dungeonKey === "189" ? "Dungeon route unknown"
          : competitionReason({ ...evidence, players: evidence.players.map(p => ({ ...p, member: null })) }, ratingRules.levelBands[dungeonKey], overlevelAllowance)
            ?? (!ratingRules.targets[dungeonKey] ? "Target not calibrated"
              : player.presentSec < (durationSec ?? 0) * 0.8 ? `Presence ${Math.floor(100 * player.presentSec / (durationSec || 1))}% / 80% required` : undefined) : undefined;
        return {
        character: player.character, ...(player.class ? { class: player.class } : {}), ...(player.role ? { role: player.role } : {}),
        ...(player.spec ? { spec: player.spec, specSource: "run" as const }
          : character?.spec ? { spec: character.spec, specSource: "profile" as const } : {}),
        deaths: player.deaths ?? null, presentSec: player.presentSec,
        points: playerPoints.get(player.character) ?? 0,
        participationMode: participationMode(evidence, player.character, band, november),
        ...(participationRecipient && participationRecipient !== player.character ? { participationRecipient } : {}),
        ...(unrankedReason ? { unrankedReason } : {}),
        ...(rated && character ? {
          ratingTotal: ratingFor(currentRating, character.memberId, player.character),
          ratingGain: ratingFor(currentRating, character.memberId, player.character)
            - ratingFor(previousRating, character.memberId, player.character)
        } : {})
        };
      }),
      guildRecord,
      previousGuildBest,
      personalRecords,
      players: run.players.map((player) => player.character),
      deaths: run.players.some((player) => typeof player.deaths === "number")
        ? run.players.reduce((sum, player) => sum + (player.deaths ?? 0), 0) : null,
      unlinked: linked.filter((entry) => !entry.character).map((entry) => entry.player.character),
      achievements
    });
    previousRating = currentRating;
  }
  return summary;
}
