import type { Prisma } from "@prisma/client";
import { grantRunAchievements, type AchievementKey } from "./dungeon-achievements.js";
import { findCharacter } from "./character-match.js";
import {
  computeRunPoints, dungeonConfig, dungeonRunSchema, validateRun, weekStart,
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
  playerDetails?: { character: string; class?: string; role?: string; spec?: string; specSource?: "run" | "profile"; deaths: number | null; presentSec: number; points: number }[];
  unlinked: string[];
  achievements: { character: string; key: AchievementKey }[];
}

export interface DungeonImportSummary {
  results: DungeonImportResult[];
  duplicates: number;
  malformed: number;
}

const NEAR_DUPLICATE_SECONDS = 120;

export async function activeSeason(tx: Pick<Prisma.TransactionClient, "dungeonSeason">, guildId: string) {
  const current = await tx.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (current) return current;
  return tx.dungeonSeason.create({ data: { guildId, name: "Season 1" } });
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
  const season = await activeSeason(tx, guildId);

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
    const earnsPoints = check.ok && run.state === "COMPLETED" && durationSec !== null;

    // Records and history are judged BEFORE this run is saved.
    let guildRecord = false;
    let previousGuildBest: number | null = null;
    const contexts: PlayerContext[] = [];
    const personalRecords: DungeonImportResult["personalRecords"] = [];
    if (earnsPoints) {
      const best = await tx.dungeonRun.findFirst({
        where: { guildId, instanceId: run.instanceId, difficultyId: run.difficultyId, valid: true, state: "COMPLETED", durationSec: { not: null } },
        orderBy: { durationSec: "asc" }
      });
      previousGuildBest = best?.durationSec ?? null;
      guildRecord = previousGuildBest !== null && durationSec < previousGuildBest;
      const weekFrom = weekStart(new Date((run.endedAt ?? 0) * 1000));
      for (const { player, character } of linked) {
        if (!character) continue;
        const history = await tx.dungeonRun.findMany({
          where: { guildId, instanceId: run.instanceId, valid: true, state: "COMPLETED", players: { some: { memberId: character.memberId } } },
          select: { durationSec: true, difficultyId: true, endedAt: true }
        });
        const sameDifficulty = history.filter((row) => row.difficultyId === run.difficultyId && row.durationSec !== null);
        const previousBest = sameDifficulty.length ? Math.min(...sameDifficulty.map((row) => row.durationSec as number)) : null;
        contexts.push({
          memberId: character.memberId,
          character: player.character,
          deaths: player.deaths,
          earlierThisWeek: history.filter((row) => row.endedAt && row.endedAt >= weekFrom).length,
          firstEver: history.length === 0,
          previousBest
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
      const target = config.targets[String(run.instanceId)];
      achievements = await grantRunAchievements(tx, guildId, { id: stored.id, seasonId: season.id }, contexts, {
        guildRecord,
        fullGuildGroup,
        underTarget: target !== undefined && durationSec <= target,
        deathless: run.players.every((player) => player.deaths === 0)
      }, config.dungeonMasterCount);
      const awards = computeRunPoints({
        instanceId: run.instanceId,
        durationSec,
        fullGuildGroup,
        guildRecord,
        players: contexts,
        config
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

    summary.results.push({
      runRef: run.id,
      dungeonName: run.name,
      difficultyId: run.difficultyId,
      state: run.state,
      valid: check.ok,
      ...(check.ok ? {} : { invalidReason: check.reason ?? "invalid" }),
      durationSec,
      points,
      ...(run.endedAt ? { endedAt: run.endedAt } : {}),
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.encounters ? { encounters: run.encounters } : {}),
      ...(run.completedBy ? { completedBy: run.completedBy } : {}),
      playerDetails: linked.map(({ player, character }) => ({
        character: player.character, ...(player.class ? { class: player.class } : {}), ...(player.role ? { role: player.role } : {}),
        ...(player.spec ? { spec: player.spec, specSource: "run" as const }
          : character?.spec ? { spec: character.spec, specSource: "profile" as const } : {}),
        deaths: player.deaths ?? null, presentSec: player.presentSec,
        points: playerPoints.get(player.character) ?? 0
      })),
      guildRecord,
      previousGuildBest,
      personalRecords,
      players: run.players.map((player) => player.character),
      deaths: run.players.some((player) => typeof player.deaths === "number")
        ? run.players.reduce((sum, player) => sum + (player.deaths ?? 0), 0) : null,
      unlinked: linked.filter((entry) => !entry.character).map((entry) => entry.player.character),
      achievements
    });
  }
  return summary;
}
