import { publicRules, readRuleSnapshot } from "./public-score.js";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import { reconcileEvidenceAwards } from "./dungeon-evidence-awards.js";
import { reconcileSummaries, summarize } from "./public-runs.js";
import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { currentIntegrityPolicy, integrityWindowReason, withIntegrityWindow } from "./dungeon-integrity.js";
import { gameEditionOf } from "./game-edition.js";
import { addonName } from "./addon-name.js";
import { currentEdition } from "./edition-context.js";
import { bracketForLevel, resolveNovemberRoute, validBracketedRules, validRouteRules } from "./dungeon-november-rules.js";
import { dungeonResetCutoff, predatesDungeonReset } from "./dungeon-reset.js";
import type { Prisma } from "../generated/prisma/client.js";
import { grantRunAchievements, type AchievementKey } from "./dungeon-achievements.js";
import { findCharacter } from "./character-match.js";
import { competitionReason, completionReason, dungeonRating, hasDungeonRating, ratingCharacterKey, type LevelBand } from "./dungeon-rating.js";
import { participationDungeonKey, participationMode, participationRecordEligible, type ParticipationRun } from "./dungeon-participation.js";
import {
  computeRunPoints, computeWeeklyVarietyPoints, sharedDungeonConfig, dungeonRunSchema, validateRun, weekStart,
  type DungeonRunInput, type PlayerContext
} from "./dungeon-rules.js";

// Turns dungeon runs from an addon import into stored runs and points
// (roadmap D3/D4). Every run is handled on its own: a malformed or invalid
// run is recorded/rejected without affecting the others, and the same run
// can never be counted twice (by run id, or by same dungeon + same players
// + start within 2 minutes when two members reported it separately).

type Tx = Pick<Prisma.TransactionClient, "officialSeason" | "dungeonRun" | "dungeonSeason" | "dungeonPointTransaction" | "guildSettings" | "dungeonAchievement" | "auditLog">
  & Partial<Pick<Prisma.TransactionClient, "$executeRaw">>;

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
  challenge?: DungeonRunInput["challenge"];
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

export async function activeSeason(tx: Pick<Prisma.TransactionClient, "dungeonSeason" | "officialSeason">, guildId: string, now = new Date()) {
  const current = await tx.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (current) return current;
  // A guild joining mid-season must get the same frozen rules as an existing guild.
  const official = await tx.officialSeason.findFirst({ where: { gameEdition: currentEdition(), startsAt: { lte: now } }, orderBy: { startsAt: "desc" } });
  const snapshot = official ? readRuleSnapshot(official.rules) : null;
  if (official && !snapshot) throw new Error("Official dungeon rules must be frozen before guild seasons can start.");
  return tx.dungeonSeason.create({ data: { guildId, name: official?.name ?? "Beta",
    ...(official ? { startsAt: official.startsAt } : {}),
    ratingRules: (snapshot?.rules ?? publicRules()) as unknown as Prisma.InputJsonValue } });
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

export async function seasonForRun(tx: Pick<Tx, "dungeonSeason">, guildId: string, active: Awaited<ReturnType<typeof activeSeason>>, endedAt: number | undefined) {
  if (!endedAt || !currentIntegrityPolicy(active.ratingRules) && endedAt * 1000 >= (active.startsAt?.getTime() ?? 0)) return active;
  const prior = await tx.dungeonSeason.findFirst({ where: { guildId, startsAt: { lte: new Date(endedAt * 1000) } }, orderBy: { startsAt: "desc" } });
  return prior && currentIntegrityPolicy(prior.ratingRules) ? prior : active;
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
  const cutoff = dungeonResetCutoff();
  const parsed = rawRuns.map((raw) => dungeonRunSchema.safeParse(raw));
  summary.malformed = parsed.filter((result) => !result.success).length;
  const runs = parsed.filter((result) => result.success).map((result) => result.data)
    .filter(run => {
      if (!predatesDungeonReset(run, cutoff)) return true;
      summary.duplicates++;
      return false;
    })
    .sort((a, b) => (a.endedAt ?? a.startedAt ?? 0) - (b.endedAt ?? b.startedAt ?? 0));
  if (!runs.length) return summary;
  // Import, rotation and finalization share this lock, including direct import callers.
  if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
  await lockDungeonCalendar(tx);
  const config = sharedDungeonConfig();
  const currentSeason = await activeSeason(tx, guildId, now);
  const ratingCache = new Map<string, Awaited<ReturnType<typeof dungeonRating>>>();

  // Oldest first, using event-time ownership for the new integrity policy.
  for (let run of runs) {
    const season = await seasonForRun(tx, guildId, currentSeason, run.endedAt);
    const rated = hasDungeonRating(season.ratingRules);
    const timed = rated && (season.ratingRules as { version: number }).version >= 3;
    const november = validBracketedRules(season.ratingRules) ? withIntegrityWindow(season.ratingRules, season.startsAt, season.endsAt)
      : validRouteRules(season.ratingRules) ? season.ratingRules : undefined;
    const brackets = validBracketedRules(season.ratingRules) ? season.ratingRules.brackets : undefined;
    const overlevelAllowance = validBracketedRules(season.ratingRules) ? season.ratingRules.overlevelPenalty.maxLevels : 0;
    const ruleVersion = (season.ratingRules as { version?: number } | null)?.version;
    if ((ruleVersion === 5 || ruleVersion === 6) && !november) throw new Error("Invalid November rules; import refused without awards");
    const bestEight = rated && ((season.ratingRules as { version: number }).version === 4 || november !== undefined);
    const ratingRules = season.ratingRules as unknown as { targets: Record<string, number>; levelBands: Record<string, LevelBand>; participationLevelBands: Record<string, LevelBand> };
    const participationRules = bestEight ? { targets: {}, levelBands: ratingRules.participationLevelBands } : timed ? season.ratingRules as unknown as { targets: Record<string, number>; levelBands: Record<string, LevelBand> } : config;

    const check = validateRun(run, now);
    if (gameEditionOf(run) !== "forever") {
      for (const player of run.players) player.character = addonName(player.character, player.realm, gameEditionOf(run));
    }
    const existing = await tx.dungeonRun.findUnique({ where: { guildId_runRef: { guildId, runRef: run.id } } });
    let reconciled = false;
    if (existing && existing.valid && existing.state === "COMPLETED" && check.ok && run.integrity?.observer && run.startedAt && run.endedAt) {
      const data = existing.competitionData as { observerReports?: unknown[]; lateObserverReports?: unknown[]; [key:string]:unknown } | null;
      const prior = (data?.observerReports ?? []).flatMap(value=>{const p=dungeonRunSchema.safeParse(value);return p.success?[p.data]:[];});
      const duplicate = prior.some(p=>JSON.stringify(p)===JSON.stringify(run));
      if (!duplicate && prior.length < 40) {
        const windowReason = season.status === "ENDED" ? "Season finalized" : integrityWindowReason(
          new Date(run.startedAt*1000),new Date(run.endedAt*1000),now,{from:season.startsAt,to:season.endsAt});
        const late = currentIntegrityPolicy(season.ratingRules) && !!windowReason;
        const reports = [...prior,run];
        const merged = !late && currentIntegrityPolicy(season.ratingRules) && prior.length ? reconcileSummaries(reports.map(p=>summarize(p,existing.createdAt))) : null;
        const observations = merged?.integrity as {run:unknown;players:{character:string;realm:string;observation:unknown}[]} | undefined;
        await tx.dungeonRun.update({where:{id:existing.id},data:{
          competitionData:{...data,...(late ? {lateObserverReports:[...(data?.lateObserverReports??[]).slice(-39),run]} : {observerReports:reports}),
            ...(merged && observations ? {integrity:observations.run,encounters:merged.encounters,
              players:merged.players.map(p=>({name:p.character,level:p.level,minLevel:p.minLevel,
                integrity:observations.players.find(q=>q.character===p.character && q.realm===p.realm)?.observation}))} : {})} as Prisma.InputJsonValue,
          ...(merged ? {startedAt:merged.startedAt,endedAt:merged.endedAt,durationSec:merged.durationSec,
            players:{deleteMany:{},create:merged.players.map(p=>({character:p.character,
              memberId:findCharacter(characters,p.character,p.realm,gameEditionOf(run))?.memberId??null,
              class:p.className,role:p.role,presentSec:p.presentSec,deaths:p.deaths,inGuild:run.players.find(q=>q.character===p.character)?.inGuild??false}))}} : {})
        }});
        if (merged && observations) {
          ratingCache.delete(season.id);
          reconciled = true;
          // Continue through the same eligibility/weekly-budget path for newly
          // eligible accounts. The existing run and ledger are never recreated.
          run={...run,startedAt:merged.startedAt.getTime()/1000,endedAt:merged.endedAt.getTime()/1000,
            integrity:observations.run as DungeonRunInput["integrity"],encounters:merged.encounters,
            players:merged.players.map(p=>({...run.players.find(q=>q.character===p.character && (q.realm==="-"?"":q.realm)===p.realm)!,
              character:p.character,realm:p.realm,role:p.role??undefined,level:p.level??undefined,minLevel:p.minLevel??undefined,
              presentSec:p.presentSec,inGuild:run.players.find(q=>q.character===p.character)?.inGuild??false,
              integrity:observations.players.find(q=>q.character===p.character&&q.realm===p.realm)?.observation as DungeonRunInput["players"][number]["integrity"]}))};
        }
      }
    }
    if (existing && !reconciled || !existing && await isNearDuplicate(tx, guildId, run)) {
      summary.duplicates++;
      continue;
    }
    const previousRating = rated ? ratingCache.get(season.id) ?? await dungeonRating(tx, guildId, season) : [];
    const durationSec = run.startedAt && run.endedAt ? run.endedAt - run.startedAt : null;
    const linked = run.players.map((player) => ({
      player,
      character: findCharacter(characters, player.character, player.realm, gameEditionOf(run))
    }));
    const evidence: ParticipationRun = {
      instanceId: run.instanceId, difficultyId: run.difficultyId, durationSec, createdAt: now,
      startedAt: run.startedAt ? new Date(run.startedAt * 1000) : null, endedAt: run.endedAt ? new Date(run.endedAt * 1000) : null,
      completedBy: run.completedBy ?? run.endReason ?? null,
      competitionData: { ...(run.integrity ? { integrity: run.integrity } : {}), players: run.players.map(p => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null, ...(p.integrity ? { integrity: p.integrity } : {}) })), encounters: run.encounters ?? [] },
      players: linked.map(({ player, character }) => ({ character: player.character, memberId: character?.memberId ?? null, presentSec: player.presentSec }))
    };
    const dungeonKey = participationDungeonKey(evidence, november);
    const novemberReason = november ? resolveNovemberRoute(evidence, november).reason : undefined;
    const band = participationRules.levelBands[dungeonKey];
    const recordEligible = participationRecordEligible(evidence, band, november);
    const inSeason = !!run.startedAt && run.startedAt * 1000 >= (season.startsAt?.getTime() ?? 0)
      && (!season.endsAt || !!run.endedAt && run.endedAt * 1000 < season.endsAt.getTime());
    const windowReason = currentIntegrityPolicy(season.ratingRules)
      ? season.status === "ENDED" ? "Season finalized" : integrityWindowReason(evidence.startedAt, evidence.endedAt, now, { from: season.startsAt, to: season.endsAt }) : undefined;
    const earnsPoints = !windowReason && (!bestEight || evidence.completedBy === "final boss" && !run.id.startsWith("SIM-")) && check.ok && run.state === "COMPLETED" && durationSec !== null && inSeason;

    // Records and history are judged BEFORE this run is saved.
    let guildRecord = false;
    let previousGuildBest: number | null = null;
    const contexts: PlayerContext[] = [];
    const personalRecords: DungeonImportResult["personalRecords"] = [];
    if (earnsPoints) {
      // Filter old evidence too: a historical carry must not block a fair record.
      const history = await tx.dungeonRun.findMany({
        where: { guildId, ...(existing ? {id:{not:existing.id}} : {}), instanceId: run.instanceId, valid: true, state: "COMPLETED", durationSec: { not: null }, ...(bestEight ? { NOT: { runRef: { startsWith: "SIM-" } } } : {}) },
        select: { instanceId: true, difficultyId: true, durationSec: true, completedBy: true, competitionData: true,
          startedAt: true, endedAt: true, createdAt: true, players: { select: { character: true, memberId: true, presentSec: true } } }
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
      const awardedAccounts = new Set<string>(existing ? (await tx.dungeonPointTransaction.findMany({where:{runId:existing.id,source:{startsWith:"rule:"}},select:{memberId:true}})).map(p=>p.memberId) : []);
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

    const stored = existing ?? await tx.dungeonRun.create({
      data: {
        guildId,
        createdAt: now,
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
        competitionData: { ...(run.integrity ? { integrity: run.integrity } : {}), players: run.players.map(p => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null, ...(p.integrity ? { integrity: p.integrity } : {}) })), encounters: run.encounters ?? [],
          observerReports:[run],
          gameBuild: run.gameBuild ?? null, startTrigger: run.startTrigger ?? null,
          challengeMode: run.challengeMode ?? false, ...(run.challenge ? { challenge: run.challenge } : {}) },
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
            role: dungeonRole(player.role),
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
      }, config.dungeonMasterCount, appliedBy, now);
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

    if(currentIntegrityPolicy(season.ratingRules) && !windowReason) {
      const deltas=await reconcileEvidenceAwards(tx,guildId,stored.id,[...new Set(linked.flatMap(p=>p.character?[p.character.memberId]:[]))],appliedBy,now);
      for(const [memberId,delta] of deltas) {
        points+=delta;
        const name=linked.find(p=>p.character?.memberId===memberId)?.player.character;
        if(name) playerPoints.set(name,(playerPoints.get(name)??0)+delta);
      }
      if(achievements.length) {
        const active=await tx.dungeonAchievement.findMany({where:{guildId,revokedAt:null,memberId:{in:linked.flatMap(p=>p.character?[p.character.memberId]:[])}},select:{memberId:true,key:true}});
        achievements=achievements.filter(a=>active.some(row=>row.key===a.key && row.memberId===linked.find(p=>p.player.character===a.character)?.character?.memberId));
      }
    }
    const currentRating = rated ? await dungeonRating(tx, guildId, season) : [];
    if (rated) ratingCache.set(season.id, currentRating);
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
      ...(run.challenge ? { challenge: run.challenge } : {}),
      playerDetails: linked.map(({ player, character }) => {
        const participationRecipient = contexts.find(p => p.memberId === character?.memberId)?.character;
        const unrankedReason = timed ? !check.ok ? check.reason ?? "Invalid run"
          : windowReason ? windowReason : !inSeason ? "Outside season window"
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
  }
  return summary;
}
