import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { isDeepStrictEqual } from "node:util";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import { currentIntegrityPolicy, integrityStartReason, readDungeonIntegrity, readPlayerIntegrity, UPLOAD_GRACE_MS } from "./dungeon-integrity.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { dungeonResetCutoff, predatesDungeonReset } from "./dungeon-reset.js";
import { dungeonRunSchema, validateRun, type DungeonRunInput } from "./dungeon-rules.js";
import { bracketForLevel, DEFAULT_DUNGEON_BRACKETS } from "./dungeon-november-rules.js";
import { publicRouteKey, readRuleSnapshot } from "./public-score.js";
import { gameEditionOf } from "./game-edition.js";
import { characterKey, characterReference } from "../../companion/character-identity.mjs";
import { challengesAgree, readChallenge, type ChallengeEvidence } from "./challenge-evidence.js";
import { encounterKey } from "./dungeon-encounter-identity.js";
import { observationReport, reconcileParticipation } from "./dungeon-observations.js";

// Public dungeon runs (7.0, roadmap request 6). Personal companions and opted-in guilds send
// finished runs; the bot checks each one before it reaches the public leaderboards:
// - the guild rules' own checks (validateRun: protocol, 3 min to 4 h, no future times, the
//   recorder and a reporter were in the run, nobody listed twice);
// - completed runs only, at most 30 days old, sent by someone who was in the run;
// - impossible times: bosses closer together than a party can kill them, boss kills outside
//   the run's start and end;
// - party agreement: party members share the addon's run id, so their uploads land on the
//   same run. Each agreeing uploader adds a confirmation when it carries another player's report
//   (a guild's copy of a member's report and that member's own upload are one report); a
//   disagreeing one marks the run DISPUTED and it leaves the leaderboards;
// - evidence (7.4): completion method, boss kills, start levels and presence are kept, so the
//   score can rank a run by the guild seasons' own check (public-score.ts rateRun);
// - duplicates: the same uploader sending the same run again changes nothing;
// - rate limits per uploader.

export const PUBLIC_LIMITS = { runsPerUpload: 50, runsPerHour: 200, requestsPerHour: 30, maxAgeDays: 30, minSecondsPerBoss: 45, agreeDurationSec: 30, agreeEndSec: 300, agreePlayers: 0.6 } as const;

export const seasonOf = (date: Date) => `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
export const runKeyOf = (run: { instanceId: number; id: string; gameEdition?: string | undefined }) => `${gameEditionOf(run) === "forever" ? "" : `${gameEditionOf(run)}:`}${run.instanceId}:${run.id}`;
const key = (name: string) => name.trim().toLowerCase();

export interface PublicCheck { ok: boolean; reason?: string }

export function checkPublicRun(run: DungeonRunInput, uploaderCharacter: string | null, now = new Date()): PublicCheck {
  const base = validateRun(run, now);
  if (!base.ok) return base;
  if (run.state !== "COMPLETED") return { ok: false, reason: "not completed" };
  const started = run.startedAt!;
  const ended = run.endedAt!;
  if (ended < Math.floor(now.getTime() / 1000) - PUBLIC_LIMITS.maxAgeDays * 86_400) return { ok: false, reason: `older than ${PUBLIC_LIMITS.maxAgeDays} days` };
  if (uploaderCharacter && !run.players.some((player) => characterKey(player.character, player.realm, gameEditionOf(run)) === characterKey(uploaderCharacter, "", gameEditionOf(run)))) return { ok: false, reason: "your character was not in this run" };
  const kills = (run.encounters ?? []).filter((encounter) => encounter.success);
  if (kills.length && ended - started < kills.length * PUBLIC_LIMITS.minSecondsPerBoss) return { ok: false, reason: "impossible time for the bosses killed" };
  for (const kill of kills) {
    if (kill.at !== undefined && (kill.at < started - 5 || kill.at > ended + 5)) return { ok: false, reason: "a boss kill falls outside the run" };
  }
  const times = kills.flatMap((kill) => (kill.at === undefined ? [] : [kill.at])).sort((a, b) => a - b);
  for (let index = 1; index < times.length; index++) {
    if (times[index]! - times[index - 1]! < 10) return { ok: false, reason: "impossible time between two bosses" };
  }
  return { ok: true };
}

export interface RunSummary {
  gameEdition: string;
  challenge?: ChallengeEvidence;
  runKey: string; runRef: string; instanceId: number; dungeonName: string; difficultyId: number; startedAt: Date; endedAt: Date; durationSec: number;
  deaths: number | null; maxLevel: number | null; bracket: string | null; season: string; routeKey: string | null;
  evidenceVersion: 1 | 2; integrity?: Prisma.InputJsonValue; evidenceReceivedAt?: Date;
  completedBy: string | null; encounters: { id: number; kind?: "npc"; name?: string; success: true; at?: number; startedAt?: number; source?: "native" | "combat-log" }[];
  players: { character: string; displayName?: string | null; realm: string; className: string | null; role: string | null; level: number | null; minLevel: number | null; presentSec: number; deaths: number | null }[];
}

export function summarize(run: DungeonRunInput, receivedAt = new Date()): RunSummary {
  const levels = run.players.flatMap((player) => (player.level ? [player.level] : []));
  const maxLevel = levels.length ? Math.max(...levels) : null;
  const deaths = run.players.some((player) => typeof player.deaths === "number") ? run.players.reduce((sum, player) => sum + (player.deaths ?? 0), 0) : null;
  const endedAt = new Date(run.endedAt! * 1000);
  return {
    gameEdition: gameEditionOf(run), runKey: runKeyOf(run), runRef: run.id, instanceId: run.instanceId, dungeonName: run.name, difficultyId: run.difficultyId,
    startedAt: new Date(run.startedAt! * 1000), endedAt, durationSec: run.endedAt! - run.startedAt!, deaths, maxLevel,
    bracket: maxLevel ? bracketForLevel(DEFAULT_DUNGEON_BRACKETS, maxLevel)?.key ?? null : null, season: seasonOf(endedAt), routeKey: publicRouteKey(run.instanceId, run.encounters ?? []),
    // The same completion field the guild import stores; only boss kills are kept.
    evidenceVersion: run.integrity ? 2 : 1, evidenceReceivedAt: receivedAt, completedBy: run.completedBy ?? run.endReason ?? null,
    ...(run.integrity ? { integrity: { run: run.integrity, players: run.players.map(p => ({ character: p.character, realm: p.realm === "-" ? "" : p.realm, observation: p.integrity ?? null })) } } : {}),
    ...(run.challenge ? { challenge: run.challenge } : {}),
    encounters: (run.encounters ?? []).filter((e) => e.success).map((e) => ({ id: e.id, ...(e.kind ? { kind: e.kind } : {}), ...(e.name ? { name: e.name } : {}), success: true as const,
      ...(e.source ? { source: e.source } : {}),
      ...(e.at !== undefined ? { at: e.at } : {}), ...(e.startedAt !== undefined ? { startedAt: e.startedAt } : {}) })),
    players: run.players.map((player) => ({ character: player.character, realm: player.realm === "-" ? "" : player.realm, className: player.class ?? null, role: dungeonRole(player.role),
      ...(player.displayName ? { displayName: player.displayName } : {}),
      level: player.level ?? null, minLevel: player.minLevel ?? null, presentSec: player.presentSec, deaths: player.deaths ?? null }))
  };
}

export type RunEvidence = Pick<RunSummary, "instanceId" | "difficultyId" | "routeKey" | "durationSec" | "startedAt" | "endedAt" | "completedBy" | "encounters"> & {
  challenge?: ChallengeEvidence;
  evidenceVersion: number;
  integrity?: unknown;
  players: (Omit<RunSummary["players"][number], "presentSec"> & { presentSec: number | null })[];
};
const playerKey = (player: { character: string; realm: string }) => `${key(player.character)}@${key(player.realm)}`;
const containsKills = (a: RunEvidence, b: RunEvidence, edition: string) => b.encounters.every(kill => a.encounters.some(other => encounterKey(other,a,edition) === encounterKey(kill,b,edition)));
function observationOf(summary: RunEvidence, edition: string) {
  const data = summary.integrity as { run?: unknown; players?: { character:string;realm:string;observation?:unknown }[] } | null;
  return observationReport(data?.run, summary.players.map(p=>({...p,integrity:data?.players?.find(q=>playerKey(q)===playerKey(p))?.observation})),
    summary.startedAt.getTime()/1000, summary.endedAt.getTime()/1000, edition);
}

/** Derived participation retains reports and never invents an individual observer's view. */
export function reconcileSummaries(reports: RunSummary[]): RunSummary | null {
  const unique = new Map<string,RunSummary>();
  for (const report of reports) {
    const {evidenceReceivedAt,...facts}=report, id=JSON.stringify(facts), previous=unique.get(id);
    if (!previous || evidenceReceivedAt && (!previous.evidenceReceivedAt || evidenceReceivedAt < previous.evidenceReceivedAt)) unique.set(id,report);
  }
  if (!unique.size || unique.size > 40) return null;
  const all = [...unique.values()];
  // Legacy reports remain raw history and constrain shared facts, but cannot
  // poison a later source-identified observation or supply invented intervals.
  const sorted = all.filter(r=>observationOf(r,r.gameEdition)).sort((a,b)=>a.startedAt.getTime()-b.startedAt.getTime() || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (!sorted.length) return null;
  const first = sorted[0]!, observations = sorted.map(r=>observationOf(r,r.gameEdition));
  if (all.some(r=>r.gameEdition!==first.gameEdition || r.runKey!==first.runKey || !agrees(first,r))) return null;
  const from = Math.min(...sorted.map(r=>r.startedAt.getTime()/1000)), to = Math.max(...sorted.map(r=>r.endedAt.getTime()/1000));
  if (sorted.some(r=>Math.abs(r.startedAt.getTime()/1000-from)>30 || Math.abs(r.endedAt.getTime()/1000-to)>30)) return null;
  // An earlier peer clock or incomplete report must not replace a qualifying
  // observer's start provenance. Keep the selected original source intact.
  const base = sorted.find(r=>!integrityStartReason((r.integrity as {run?:unknown}|undefined)?.run,new Date(from*1000),to-from)) ?? first;
  const players = [...new Map(sorted.flatMap(r=>r.players).map(p=>[playerKey(p),p])).values()].sort((a,b)=>playerKey(a).localeCompare(playerKey(b)));
  const participant = players.map(p=>({character:p.character,realm:p.realm,observation:reconcileParticipation(observations.filter(o=>o!==null),p,from,to,base.gameEdition)}));
  const encounters = [...new Map(sorted.flatMap(r=>r.encounters).sort((a,b)=>Number(a.source==="native")-Number(b.source==="native") || (a.at??0)-(b.at??0)).map(e=>[`${e.kind??"encounter"}:${e.id}`,e])).values()];
  const data = base.integrity as {run: Prisma.InputJsonValue};
  return {...base,startedAt:new Date(from*1000),endedAt:new Date(to*1000),durationSec:to-from,encounters,
    players:players.map(p=>({...p,presentSec:participant.find(q=>playerKey(q)===playerKey(p))?.observation?.knownSec ?? 0})),
    integrity:{run:data.run,players:participant as unknown as Prisma.InputJsonValue,
      observers:[...new Set(observations.map(o=>o!.observer.toLowerCase()))].sort(),coverage:"catalog-checkpoints",freshness:"unknown"}};
}
function savedSummary(value: unknown): RunSummary | null {
  if (!value || typeof value !== "object") return null;
  const {previousRevisions,canonicalEligible,admittedAt,...data} = value as RunSummary & {previousRevisions?:unknown;canonicalEligible?:unknown;admittedAt?:unknown};
  void previousRevisions;void canonicalEligible;void admittedAt;
  if (!Array.isArray(data.players) || !Array.isArray(data.encounters) || typeof data.gameEdition !== "string") return null;
  const result = {...data,startedAt:new Date(data.startedAt),endedAt:new Date(data.endedAt),
    ...(data.evidenceReceivedAt ? {evidenceReceivedAt:new Date(data.evidenceReceivedAt)} : {})};
  return Number.isFinite(result.startedAt.getTime()) && Number.isFinite(result.endedAt.getTime()) && observationOf(result,result.gameEdition) ? result : null;
}

// Incomplete observations can agree; conflicting known scoring facts cannot.
export function agrees(stored: RunEvidence, incoming: RunSummary): boolean {
  // Integrity is local observation, not a shared scoring fact. A distant party
  // member, reload, or unknown API result must not dispute an otherwise matching
  // clear. Keep each report separately; never add overlapping observer seconds.
  if (!challengesAgree(stored.challenge, incoming.challenge)) return false;
  const oldObservation = observationOf(stored,incoming.gameEdition), newObservation = observationOf(incoming,incoming.gameEdition);
  const observed = !!oldObservation && !!newObservation;
  if (stored.instanceId !== incoming.instanceId || stored.difficultyId !== incoming.difficultyId) return false;
  if (stored.routeKey && incoming.routeKey && stored.routeKey !== incoming.routeKey) return false;
  if (Math.abs(stored.durationSec - incoming.durationSec) > PUBLIC_LIMITS.agreeDurationSec) return false;
  if (Math.abs(stored.endedAt.getTime() - incoming.endedAt.getTime()) > PUBLIC_LIMITS.agreeEndSec * 1000) return false;
  const mine = new Set(stored.players.map(playerKey));
  const theirs = incoming.players.map(playerKey);
  const shared = theirs.filter((name) => mine.has(name)).length;
  if (shared / Math.max(mine.size, theirs.length, 1) < PUBLIC_LIMITS.agreePlayers) return false;
  for (const player of incoming.players) {
    const old = stored.players.find(p => playerKey(p) === playerKey(player));
    if (!old) continue;
    const roleCanDiffer = observed && (oldObservation.observer.toLowerCase() !== newObservation.observer.toLowerCase()
      || readPlayerIntegrity(oldObservation.players.find(p=>playerKey(p)===playerKey(player))?.integrity)?.mixedRole
      || readPlayerIntegrity(newObservation.players.find(p=>playerKey(p)===playerKey(player))?.integrity)?.mixedRole);
    if (!roleCanDiffer && dungeonRole(old.role) && dungeonRole(player.role) && dungeonRole(old.role) !== dungeonRole(player.role)) return false;
    for (const field of ["level", "minLevel"] as const) {
      if (old[field] !== null && player[field] !== null && old[field] !== player[field]) return false;
    }
    if (!oldObservation && !newObservation && old.presentSec !== null && (Math.abs(old.presentSec - player.presentSec) > PUBLIC_LIMITS.agreeDurationSec
      || (old.presentSec >= 0.8 * stored.durationSec) !== (player.presentSec >= 0.8 * incoming.durationSec))) return false;
  }
  if (!observed && !containsKills(stored, incoming, incoming.gameEdition) && !containsKills(incoming, stored, incoming.gameEdition)) return false;
  for (const kill of incoming.encounters) {
    const old = stored.encounters.find(e => encounterKey(e,stored,incoming.gameEdition) === encounterKey(kill,incoming,incoming.gameEdition));
    if (old?.at !== undefined && kill.at !== undefined && Math.abs(old.at - kill.at) > PUBLIC_LIMITS.agreeDurationSec) return false;
  }
  if (stored.completedBy && incoming.completedBy && stored.completedBy !== incoming.completedBy
    && stored.completedBy !== "final boss" && incoming.completedBy !== "final boss") return false;
  return true;
}

/** Replace a whole observation only with strictly better, compatible evidence; never splice reports. */
export function evidenceUpgrade(stored: RunEvidence, incoming: RunSummary): boolean {
  if (!agrees(stored, incoming) || stored.durationSec !== incoming.durationSec
    || stored.startedAt.getTime() !== incoming.startedAt.getTime() || stored.endedAt.getTime() !== incoming.endedAt.getTime()
    || stored.players.length !== incoming.players.length || !containsKills(incoming, stored,incoming.gameEdition)) return false;
  if (stored.players.some(old => !incoming.players.some(p => playerKey(p) === playerKey(old)
    && (old.level === null || p.level === old.level) && (old.minLevel === null || p.minLevel === old.minLevel)
    && (!dungeonRole(old.role) || dungeonRole(p.role) === dungeonRole(old.role)) && (old.presentSec === null || p.presentSec === old.presentSec)))) return false;
  if (incoming.completedBy !== "final boss" && incoming.completedBy !== "challenge objectives") return false;
  if (stored.challenge && !incoming.challenge) return false;
  // Kill times/start times are retained evidence too. A longer checklist must not
  // silently discard the observed clocks used by public checks and boss records.
  if (stored.encounters.some(old => !incoming.encounters.some(e => e.id === old.id && e.kind === old.kind
    && (old.at === undefined || e.at === old.at) && (old.startedAt === undefined || e.startedAt === old.startedAt)))) return false;
  const richerPlayers = stored.players.some(old => incoming.players.some(p => playerKey(p) === playerKey(old)
    && (["level", "minLevel", "role", "presentSec"] as const).some(field => old[field] === null && p[field] !== null)));
  const richerKills = stored.encounters.some(old => incoming.encounters.some(e => e.id === old.id && e.kind === old.kind
    && (old.at === undefined && e.at !== undefined || old.startedAt === undefined && e.startedAt !== undefined)));
  return !observationOf(stored,incoming.gameEdition) && !!observationOf(incoming,incoming.gameEdition)
    || stored.evidenceVersion < incoming.evidenceVersion || stored.completedBy !== incoming.completedBy || !stored.challenge && !!incoming.challenge
    || incoming.encounters.length > stored.encounters.length || richerPlayers || richerKills;
}

/** reporters: every character (lowercase) whose report an upload of this run carried. */
export interface StoredRun extends RunEvidence { id: string; status: string; uploaders: string[]; reporters: string[] }
export interface Uploader { key: string; reporters: string[] }

export interface PublicRunStore {
  supportsEvidenceRevisions?: boolean;
  findRun(runKey: string): Promise<StoredRun | null>;
  createRun(summary: RunSummary, uploader: Uploader, source: "personal" | "guild"): Promise<void | {historyOnly:boolean}>;
  /** Rechecks agreement and reporter independence atomically against the latest stored evidence. */
  addUpload(runId: string, uploader: Uploader, summary: RunSummary): Promise<{ agree: boolean; duplicate: boolean; historyOnly?: boolean }>;
  uploadsSince(uploaderKey: string, since: Date): Promise<number>;
  /** The run ids this uploader's runs are stored under, for the addon's "synced" marks. */
  storedRefs(uploaderKey: string, gameEdition?: string): Promise<string[]>;
}

export interface IngestResult { accepted: string[]; confirmed: string[]; duplicates: string[]; historyOnly: string[]; rejected: { id: string; reason: string }[]; acceptedRunRefs: string[] }
export class PublicUploadError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function ingestPublicRuns(store: PublicRunStore, input: { uploaderKey: string; character: string | null; gameEdition?: string; source: "personal" | "guild"; runs: unknown }, now = new Date()): Promise<IngestResult> {
  const cutoff = dungeonResetCutoff();
  if (!Array.isArray(input.runs)) throw new PublicUploadError("runs must be a list", 400);
  if (input.runs.length > PUBLIC_LIMITS.runsPerUpload) throw new PublicUploadError(`Send at most ${PUBLIC_LIMITS.runsPerUpload} runs at once.`, 413);
  if (input.source === "personal" && await store.uploadsSince(input.uploaderKey, new Date(now.getTime() - 3_600_000)) >= PUBLIC_LIMITS.runsPerHour) {
    throw new PublicUploadError("Too many runs sent in the last hour. Try again later.", 429);
  }
  const result: IngestResult = { accepted: [], confirmed: [], duplicates: [], historyOnly: [], rejected: [], acceptedRunRefs: [] };
  const seen = new Set<string>();
  for (const raw of input.runs) {
    const parsed = dungeonRunSchema.safeParse(raw);
    const id = typeof (raw as { id?: unknown })?.id === "string" ? String((raw as { id: string }).id).slice(0, 100) : "?";
    if (!parsed.success) { result.rejected.push({ id, reason: "not a valid run" }); continue; }
    const run = parsed.data;
    try {
      const edition = gameEditionOf(run);
      if (input.gameEdition !== undefined && input.gameEdition !== edition) throw new Error("The run and uploader use different WoW editions.");
    } catch (error) {
      result.rejected.push({ id, reason: error instanceof Error ? error.message : "Invalid WoW edition" });
      continue;
    }
    if (predatesDungeonReset(run, cutoff)) { result.rejected.push({ id: run.id, reason: "run predates the owner's dungeon history reset" }); continue; }
    // Unfinished runs are simply not public; they are not an error.
    if (run.state !== "COMPLETED") continue;
    const check = checkPublicRun(run, input.character, now);
    if (!check.ok) { result.rejected.push({ id: run.id, reason: check.reason! }); continue; }
    const summary = summarize(run, now);
    const seenKey=store.supportsEvidenceRevisions ? JSON.stringify(evidenceFacts(summary)) : summary.runKey;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    // A personal upload is its character's report; a guild's copy carries its reporters' and recorder's.
    const observer = observationOf(summary, summary.gameEdition)?.observer;
    const reporters = [...new Set((observer ? [observer] : input.character ? [input.character] : [...run.reporterNames ?? [], ...run.recorder ? [run.recorder] : []]).map(key))];
    const uploader = { key: input.uploaderKey, reporters };
    let stored = await store.findRun(summary.runKey);
    if (!stored) {
      try {
        const created=await store.createRun(summary, uploader, input.source);
        if(created?.historyOnly) result.historyOnly.push(run.id); else result.accepted.push(run.id);
        continue;
      } catch (error) {
        // Two companions can both observe "not found" before the first insert.
        // The unique key chooses the winner; the other report still needs the
        // same atomic agreement/deduplication path as every later upload.
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
        stored = await store.findRun(summary.runKey);
        if (!stored) throw error;
      }
    }
    if (stored.uploaders.includes(input.uploaderKey) && !store.supportsEvidenceRevisions) { result.duplicates.push(run.id); continue; }
    const { agree, duplicate, historyOnly } = await store.addUpload(stored.id, uploader, summary);
    if (duplicate) result.duplicates.push(run.id);
    else if (historyOnly) result.historyOnly.push(run.id);
    else if (agree) result.confirmed.push(run.id);
    else result.rejected.push({ id: run.id, reason: "other party members sent a different result; the run is held for review" });
  }
  result.acceptedRunRefs = (await store.storedRefs(input.uploaderKey, input.gameEdition ?? "forever")).slice(0, 500);
  return result;
}

/** Calendar cutoff uses the stored run's edition/end, never the late reporter's. */
export function publicEvidenceFinalized(rows: { startsAt: Date; rules: unknown }[], endedAt: Date, receivedAt: Date): boolean {
  const sorted = [...rows].sort((a,b)=>a.startsAt.getTime()-b.startsAt.getTime());
  const index = sorted.findIndex((row,i)=>row.startsAt <= endedAt && (!sorted[i+1] || endedAt < sorted[i+1]!.startsAt));
  const row = sorted[index], next = sorted[index+1];
  return !!row && !!next && currentIntegrityPolicy(readRuleSnapshot(row.rules)?.rules)
    && receivedAt.getTime() >= next.startsAt.getTime() + UPLOAD_GRACE_MS;
}
const uploadEvidence = (summary: RunSummary): Prisma.InputJsonValue => JSON.parse(JSON.stringify(summary)) as Prisma.InputJsonValue;
function evidenceFacts(value: unknown): unknown {
  if (!value || typeof value!=="object") return value;
  const data=JSON.parse(JSON.stringify(value)) as Record<string,unknown>;
  delete data["evidenceReceivedAt"];delete data["previousRevisions"];delete data["canonicalEligible"];delete data["admittedAt"];
  return data;
}
function revisionsOf(value: unknown): unknown[] {
  const data=value as {previousRevisions?:unknown[]} | null;
  return Array.isArray(data?.previousRevisions) ? data.previousRevisions : [];
}
function rawRevision(value: unknown): unknown {
  if (!value || typeof value!=="object") return value;
  const data=JSON.parse(JSON.stringify(value)) as Record<string,unknown>;
  delete data["previousRevisions"];return data;
}

export function prismaPublicRunStore(database: PrismaClient, clock:()=>Date=()=>new Date()): PublicRunStore {
  const select = { id: true, status: true, gameEdition: true, instanceId: true, difficultyId: true, routeKey: true, durationSec: true, startedAt: true, endedAt: true,
    evidenceVersion: true, integrity: true, completedBy: true, encounters: true, challenge: true, players: true, uploads: { select: { uploaderKey: true, reporters: true, evidence: true, historyOnly: true } } } as const;
  function storedRow(row: Prisma.PublicRunGetPayload<{ select: typeof select }>): StoredRun {
    const { challenge, ...rest } = row;
    const evidence = readChallenge(challenge);
    return { ...rest, ...(evidence ? { challenge: evidence } : {}), encounters: Array.isArray(row.encounters) ? row.encounters as RunSummary["encounters"] : [],
      uploaders: row.uploads.map(u => u.uploaderKey), reporters: [...new Set(row.uploads.flatMap(u => u.reporters))] };
  }
  return {
    supportsEvidenceRevisions:true,
    async findRun(runKey) {
      const row = await database.publicRun.findUnique({ where: { runKey }, select });
      return row ? storedRow(row) : null;
    },
    async createRun(summary, uploader, source) {
      const { players, encounters, ...run } = summary;
      return database.$transaction(async tx=>{
      await lockDungeonCalendar(tx,false,gameEditionOf(summary));
      const windows=await tx.officialSeason.findMany({where:{gameEdition:summary.gameEdition},select:{startsAt:true,rules:true}});
      const admittedAt=new Date(Math.max(clock().getTime(),summary.evidenceReceivedAt?.getTime()??0));
      const historyOnly=publicEvidenceFinalized(windows,summary.endedAt,admittedAt);
      await tx.publicRun.create({ data: {
        ...run, encounters: encounters as Prisma.InputJsonValue, source, confirmations: 1,
        ...(historyOnly?{evidenceReceivedAt:admittedAt}:{}),
        players: { create: players.filter((player, index) => players.findIndex((other) => playerKey(other) === playerKey(player)) === index) },
        uploads: { create: { uploaderKey: uploader.key, reporters: uploader.reporters, durationSec: summary.durationSec, endedAt: summary.endedAt, historyOnly,
          evidence:{...uploadEvidence(summary) as Prisma.InputJsonObject,canonicalEligible:!historyOnly,admittedAt:admittedAt.toISOString()} } }
      } });
      return {historyOnly};
      });
    },
    async addUpload(runId, uploader, summary) {
      return database.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`public-run:${runId}`}, 0))`;
        const row = await tx.publicRun.findUniqueOrThrow({ where: { id: runId }, select });
        const stored = storedRow(row);
        const previous=row.uploads.find(u=>u.uploaderKey===uploader.key);
        if (previous && [previous.evidence,...revisionsOf(previous.evidence)].some(e=>isDeepStrictEqual(evidenceFacts(e),evidenceFacts(summary)))) return { agree: true, duplicate: true };
        // A revision is the same uploader, never an additional confirmation.
        // Legacy retries keep their old immutable behavior unless strictly richer.
        if (previous && !observationOf(summary,summary.gameEdition) && !evidenceUpgrade(stored,summary)) return {agree:true,duplicate:true};
        const revisions=previous ? [...revisionsOf(previous.evidence),rawRevision(previous.evidence)] : [];
        if (revisions.length>=40) throw new PublicUploadError("Evidence revision limit reached; request a review of this run.",409);
        await lockDungeonCalendar(tx,false,gameEditionOf(row));
        const windows = await tx.officialSeason.findMany({ where: { gameEdition: row.gameEdition }, select: { startsAt: true, rules: true } });
        // Admission is checked after both locks. A request timestamp is not a
        // reservation: queued work cannot rewrite canonical evidence after grace.
        const admittedAt=new Date(Math.max(clock().getTime(),summary.evidenceReceivedAt?.getTime()??0));
        const historyOnly = publicEvidenceFinalized(windows, stored.endedAt, admittedAt);
        const agree = agrees(stored, summary);
        const confirm = !previous && agree && uploader.reporters.length > 0 && !uploader.reporters.some(name => stored.reporters.includes(name));
        const evidence={...uploadEvidence(summary) as Prisma.InputJsonObject,canonicalEligible:!historyOnly,admittedAt:admittedAt.toISOString(),...(previous?{previousRevisions:revisions as Prisma.InputJsonValue}: {})};
        if (previous) await tx.publicRunUpload.update({where:{runId_uploaderKey:{runId,uploaderKey:uploader.key}},data:{
          evidence,reporters:[...new Set([...previous.reporters,...uploader.reporters])],durationSec:summary.durationSec,endedAt:summary.endedAt,
          // Row flag means no timely revision exists; each revision owns its
          // eligibility. A late successor never poisons its timely predecessor.
          historyOnly:previous.historyOnly && historyOnly}});
        else await tx.publicRunUpload.create({ data: { runId, uploaderKey: uploader.key, reporters: uploader.reporters, durationSec: summary.durationSec, endedAt: summary.endedAt,
          evidence, historyOnly } });
        // Preserve late reports for review without rewriting final canonical
        // evidence, confirmations, disputes, standings or awards.
        if (historyOnly) return { agree, duplicate: false, historyOnly: true };
        const window = [...windows].filter(w=>w.startsAt<=stored.endedAt).sort((a,b)=>b.startsAt.getTime()-a.startsAt.getTime())[0];
        const observedPolicy = currentIntegrityPolicy(readRuleSnapshot(window?.rules)?.rules);
        const merged = stored.status === "ACCEPTED" && agree && observedPolicy
          ? reconcileSummaries([...row.uploads.flatMap(u=>[...revisionsOf(u.evidence),u.evidence].filter(value=>{
            const revision=value as {canonicalEligible?:boolean;evidenceReceivedAt?:string}|null;
            if(revision?.canonicalEligible===false) return false;
            if(revision?.canonicalEligible===true) return true;
            // Compatibility with older saved revisions: receipt time can prove
            // the original was timely even if its old row flag was later poisoned.
            const received=new Date(revision?.evidenceReceivedAt??"");
            return Number.isFinite(received.getTime()) ? !publicEvidenceFinalized(windows,stored.endedAt,received) : !u.historyOnly;
          })).map(savedSummary).filter(r=>r!==null),summary]) : null;
        const promoted = merged ?? summary;
        const promote = !!merged || stored.status === "ACCEPTED" && evidenceUpgrade(stored, summary);
        await tx.publicRun.update({ where: { id: runId }, data: {
          ...(!agree ? { status: "DISPUTED" } : confirm ? { confirmations: { increment: 1 } } : {}),
          ...(promote ? { evidenceVersion: promoted.evidenceVersion, ...(promoted.integrity ? { integrity: promoted.integrity, evidenceReceivedAt: promoted.evidenceReceivedAt } : {}), completedBy: promoted.completedBy, encounters: promoted.encounters as Prisma.InputJsonValue,
            ...(promoted.challenge ? { challenge: promoted.challenge } : {}),
            ...(merged ? {startedAt:merged.startedAt,endedAt:merged.endedAt,durationSec:merged.durationSec} : {}),
            routeKey: promoted.routeKey, maxLevel: promoted.maxLevel, bracket: promoted.bracket,
            players: { deleteMany: {}, create: promoted.players } } : {})
        } });
        return { agree, duplicate: false };
      });
    },
    uploadsSince: (uploaderKey, since) => database.publicRunUpload.count({ where: { uploaderKey, createdAt: { gte: since } } }),
    async storedRefs(uploaderKey, gameEdition = "forever") {
      const rows = await database.publicRunUpload.findMany({ where: { uploaderKey, run: { gameEdition } }, orderBy: { createdAt: "desc" }, take: 500, select: { run: { select: { runRef: true } } } });
      return rows.map((row) => row.run.runRef);
    }
  };
}

// Sharing-enabled guilds (GuildSettings.publicDungeonRuns): their valid completed runs, as the bot
// already stored and checked them, go through the same public checks under "guild:<id>".
export async function publishGuildRuns(database: PrismaClient, store: PublicRunStore = prismaPublicRunStore(database), now = new Date()): Promise<number> {
  const guilds = await database.guildSettings.findMany({ where: { publicDungeonRuns: true }, select: { guildId: true, publicDungeonRunsSince: true, guild: { select: { gameEdition: true } } } });
  let published = 0;
  for (const { guildId, publicDungeonRunsSince, guild } of guilds) {
    const gameEdition = gameEditionOf(guild ?? {});
    const uploaderKey = `guild:${guildId}`;
    const known = new Set(await store.storedRefs(uploaderKey, gameEdition));
    const rows = await database.dungeonRun.findMany({
      where: {
        guildId, valid: true, state: "COMPLETED",
        endedAt: { gte: new Date(now.getTime() - PUBLIC_LIMITS.maxAgeDays * 86_400_000) },
        ...(publicDungeonRunsSince ? { startedAt: { gte: publicDungeonRunsSince } } : {})
      },
      orderBy: { endedAt: "desc" }, take: 200,
      include: { players: { include: { member: { select: { characters: { select: { name: true, displayName: true, realm: true } } } } } } }
    });
    const runs: unknown[] = rows.filter((row) => (!known.has(row.runRef) || store.supportsEvidenceRevisions && readDungeonIntegrity((row.competitionData as {integrity?:unknown}|null)?.integrity)?.observer) && row.startedAt && row.endedAt).flatMap((row):unknown[] => {
      const reports=(row.competitionData as {observerReports?:unknown[]}|null)?.observerReports;
      // Publish originals, never relabel the derived multi-observer intervals as
      // the canonical start observer's own measurements.
      if (store.supportsEvidenceRevisions && Array.isArray(reports) && reports.length) return reports;
      const levels = new Map(((row.competitionData as { players?: { name: string; level: number | null; minLevel?: number | null }[] } | null)?.players ?? []).map((p) => [key(p.name), p]));
      return [{
        gameEdition, id: row.runRef, protocolVersion: row.protocolVersion, state: row.state, instanceId: row.instanceId, name: row.dungeonName, difficultyId: row.difficultyId,
        startedAt: Math.floor(row.startedAt!.getTime() / 1000), endedAt: Math.floor(row.endedAt!.getTime() / 1000), reporters: row.reporters,
        // completedBy may hold an older addon's end reason (up to 80 characters); uploads allow 40.
        ...(row.recorder ? { recorder: row.recorder } : {}), ...(row.completedBy ? { completedBy: row.completedBy.slice(0, 40) } : {}),
        ...(row.reporterNames.length ? { reporterNames: row.reporterNames.slice(0, 10) } : {}),
        encounters: (row.competitionData as { encounters?: unknown[] } | null)?.encounters ?? [],
        integrity: readDungeonIntegrity((row.competitionData as { integrity?: unknown } | null)?.integrity) ?? undefined,
        ...((row.competitionData as { challenge?: unknown } | null)?.challenge ? {
          challengeMode: true, challenge: (row.competitionData as { challenge: unknown }).challenge } : {}),
        players: row.players.map((player) => {
          const seen = levels.get(key(player.character));
          const linked = player.member?.characters.find(character => characterKey(character.name, character.realm, gameEdition) === characterKey(player.character, "", gameEdition));
          return {
            ...characterReference(player.character, linked?.realm ?? "-", gameEdition),
            ...(linked?.displayName ? { displayName: linked.displayName } : {}),
            ...(player.class ? { class: player.class } : {}), ...(player.role ? { role: player.role } : {}),
            ...(seen?.level ? { level: seen.level } : {}), ...(seen?.minLevel ? { minLevel: seen.minLevel } : {}),
            integrity: readPlayerIntegrity((seen as { integrity?: unknown } | undefined)?.integrity) ?? undefined,
            deaths: player.deaths, presentSec: player.presentSec, inGuild: player.inGuild
          };
        })
      }];
    });
    if (!runs.length) continue;
    for (let start = 0; start < runs.length; start += PUBLIC_LIMITS.runsPerUpload) {
      const result = await ingestPublicRuns(store, { uploaderKey, character: null, source: "guild", runs: runs.slice(start, start + PUBLIC_LIMITS.runsPerUpload) }, now);
      published += result.accepted.length + result.confirmed.length;
    }
  }
  return published;
}
