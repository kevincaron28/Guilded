import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { dungeonRunSchema, validateRun, type DungeonRunInput } from "./dungeon-rules.js";
import { bracketForLevel, DEFAULT_DUNGEON_BRACKETS } from "./dungeon-november-rules.js";
import { publicRouteKey } from "./public-score.js";

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
export const runKeyOf = (run: { instanceId: number; id: string }) => `${run.instanceId}:${run.id}`;
const key = (name: string) => name.trim().toLowerCase();

export interface PublicCheck { ok: boolean; reason?: string }

export function checkPublicRun(run: DungeonRunInput, uploaderCharacter: string | null, now = new Date()): PublicCheck {
  const base = validateRun(run, now);
  if (!base.ok) return base;
  if (run.state !== "COMPLETED") return { ok: false, reason: "not completed" };
  const started = run.startedAt!;
  const ended = run.endedAt!;
  if (ended < Math.floor(now.getTime() / 1000) - PUBLIC_LIMITS.maxAgeDays * 86_400) return { ok: false, reason: `older than ${PUBLIC_LIMITS.maxAgeDays} days` };
  if (uploaderCharacter && !run.players.some((player) => key(player.character) === key(uploaderCharacter))) return { ok: false, reason: "your character was not in this run" };
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
  runKey: string; runRef: string; instanceId: number; dungeonName: string; difficultyId: number; startedAt: Date; endedAt: Date; durationSec: number;
  deaths: number | null; maxLevel: number | null; bracket: string | null; season: string; routeKey: string | null;
  evidenceVersion: 1; completedBy: string | null; encounters: { id: number; name?: string; success: true; at?: number; startedAt?: number }[];
  players: { character: string; realm: string; className: string | null; role: string | null; level: number | null; minLevel: number | null; presentSec: number; deaths: number | null }[];
}

export function summarize(run: DungeonRunInput): RunSummary {
  const levels = run.players.flatMap((player) => (player.level ? [player.level] : []));
  const maxLevel = levels.length ? Math.max(...levels) : null;
  const deaths = run.players.some((player) => typeof player.deaths === "number") ? run.players.reduce((sum, player) => sum + (player.deaths ?? 0), 0) : null;
  const endedAt = new Date(run.endedAt! * 1000);
  return {
    runKey: runKeyOf(run), runRef: run.id, instanceId: run.instanceId, dungeonName: run.name, difficultyId: run.difficultyId,
    startedAt: new Date(run.startedAt! * 1000), endedAt, durationSec: run.endedAt! - run.startedAt!, deaths, maxLevel,
    bracket: maxLevel ? bracketForLevel(DEFAULT_DUNGEON_BRACKETS, maxLevel)?.key ?? null : null, season: seasonOf(endedAt), routeKey: publicRouteKey(run.instanceId, run.encounters ?? []),
    // The same completion field the guild import stores; only boss kills are kept.
    evidenceVersion: 1, completedBy: run.completedBy ?? run.endReason ?? null,
    encounters: (run.encounters ?? []).filter((e) => e.success).map((e) => ({ id: e.id, ...(e.name ? { name: e.name } : {}), success: true as const,
      ...(e.at !== undefined ? { at: e.at } : {}), ...(e.startedAt !== undefined ? { startedAt: e.startedAt } : {}) })),
    players: run.players.map((player) => ({ character: player.character, realm: player.realm === "-" ? "" : player.realm, className: player.class ?? null, role: player.role ?? null,
      level: player.level ?? null, minLevel: player.minLevel ?? null, presentSec: player.presentSec, deaths: player.deaths ?? null }))
  };
}

// Two uploads of one run agree when they tell the same story: same length (within 30 s), same
// end (within 5 min) and mostly the same party.
export function agrees(stored: { durationSec: number; endedAt: Date; players: string[] }, incoming: RunSummary): boolean {
  if (Math.abs(stored.durationSec - incoming.durationSec) > PUBLIC_LIMITS.agreeDurationSec) return false;
  if (Math.abs(stored.endedAt.getTime() - incoming.endedAt.getTime()) > PUBLIC_LIMITS.agreeEndSec * 1000) return false;
  const mine = new Set(stored.players.map(key));
  const theirs = incoming.players.map((player) => key(player.character));
  const shared = theirs.filter((name) => mine.has(name)).length;
  return shared / Math.max(mine.size, theirs.length, 1) >= PUBLIC_LIMITS.agreePlayers;
}

/** reporters: every character (lowercase) whose report an upload of this run carried. */
export interface StoredRun { id: string; status: string; durationSec: number; endedAt: Date; players: string[]; uploaders: string[]; reporters: string[] }
export interface Uploader { key: string; reporters: string[] }

export interface PublicRunStore {
  findRun(runKey: string): Promise<StoredRun | null>;
  createRun(summary: RunSummary, uploader: Uploader, source: "personal" | "guild"): Promise<void>;
  /** Adds the uploader; agree=false marks the run DISPUTED, confirm=true adds a confirmation. */
  addUpload(runId: string, uploader: Uploader, summary: RunSummary, agree: boolean, confirm: boolean): Promise<void>;
  uploadsSince(uploaderKey: string, since: Date): Promise<number>;
  /** The run ids this uploader's runs are stored under, for the addon's "synced" marks. */
  storedRefs(uploaderKey: string): Promise<string[]>;
}

export interface IngestResult { accepted: string[]; confirmed: string[]; duplicates: string[]; rejected: { id: string; reason: string }[]; acceptedRunRefs: string[] }
export class PublicUploadError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function ingestPublicRuns(store: PublicRunStore, input: { uploaderKey: string; character: string | null; source: "personal" | "guild"; runs: unknown }, now = new Date()): Promise<IngestResult> {
  if (!Array.isArray(input.runs)) throw new PublicUploadError("runs must be a list", 400);
  if (input.runs.length > PUBLIC_LIMITS.runsPerUpload) throw new PublicUploadError(`Send at most ${PUBLIC_LIMITS.runsPerUpload} runs at once.`, 413);
  if (input.source === "personal" && await store.uploadsSince(input.uploaderKey, new Date(now.getTime() - 3_600_000)) >= PUBLIC_LIMITS.runsPerHour) {
    throw new PublicUploadError("Too many runs sent in the last hour. Try again later.", 429);
  }
  const result: IngestResult = { accepted: [], confirmed: [], duplicates: [], rejected: [], acceptedRunRefs: [] };
  const seen = new Set<string>();
  for (const raw of input.runs) {
    const parsed = dungeonRunSchema.safeParse(raw);
    const id = typeof (raw as { id?: unknown })?.id === "string" ? String((raw as { id: string }).id).slice(0, 100) : "?";
    if (!parsed.success) { result.rejected.push({ id, reason: "not a valid run" }); continue; }
    const run = parsed.data;
    // Unfinished runs are simply not public; they are not an error.
    if (run.state !== "COMPLETED") continue;
    const check = checkPublicRun(run, input.character, now);
    if (!check.ok) { result.rejected.push({ id: run.id, reason: check.reason! }); continue; }
    const summary = summarize(run);
    if (seen.has(summary.runKey)) continue;
    seen.add(summary.runKey);
    // A personal upload is its character's report; a guild's copy carries its reporters' and recorder's.
    const reporters = [...new Set((input.character ? [input.character] : [...run.reporterNames ?? [], ...run.recorder ? [run.recorder] : []]).map(key))];
    const uploader = { key: input.uploaderKey, reporters };
    const stored = await store.findRun(summary.runKey);
    if (!stored) { await store.createRun(summary, uploader, input.source); result.accepted.push(run.id); continue; }
    if (stored.uploaders.includes(input.uploaderKey)) { result.duplicates.push(run.id); continue; }
    const agree = agrees(stored, summary);
    await store.addUpload(stored.id, uploader, summary, agree, agree && !reporters.some((name) => stored.reporters.includes(name)));
    if (agree) result.confirmed.push(run.id);
    else result.rejected.push({ id: run.id, reason: "other party members sent a different result; the run is held for review" });
  }
  result.acceptedRunRefs = (await store.storedRefs(input.uploaderKey)).slice(0, 500);
  return result;
}

export function prismaPublicRunStore(database: PrismaClient): PublicRunStore {
  return {
    async findRun(runKey) {
      const row = await database.publicRun.findUnique({ where: { runKey }, select: { id: true, status: true, durationSec: true, endedAt: true, players: { select: { character: true } }, uploads: { select: { uploaderKey: true, reporters: true } } } });
      return row ? { id: row.id, status: row.status, durationSec: row.durationSec, endedAt: row.endedAt, players: row.players.map((p) => p.character),
        uploaders: row.uploads.map((u) => u.uploaderKey), reporters: [...new Set(row.uploads.flatMap((u) => u.reporters))] } : null;
    },
    async createRun(summary, uploader, source) {
      const { players, encounters, ...run } = summary;
      await database.publicRun.create({ data: {
        ...run, encounters: encounters as Prisma.InputJsonValue, source, confirmations: 1,
        players: { create: players.filter((player, index) => players.findIndex((other) => key(other.character) === key(player.character)) === index) },
        uploads: { create: { uploaderKey: uploader.key, reporters: uploader.reporters, durationSec: summary.durationSec, endedAt: summary.endedAt } }
      } });
    },
    async addUpload(runId, uploader, summary, agree, confirm) {
      await database.$transaction([
        database.publicRunUpload.create({ data: { runId, uploaderKey: uploader.key, reporters: uploader.reporters, durationSec: summary.durationSec, endedAt: summary.endedAt } }),
        ...(agree && !confirm ? [] : [database.publicRun.update({ where: { id: runId }, data: agree ? { confirmations: { increment: 1 } } : { status: "DISPUTED" } })])
      ]);
    },
    uploadsSince: (uploaderKey, since) => database.publicRunUpload.count({ where: { uploaderKey, createdAt: { gte: since } } }),
    async storedRefs(uploaderKey) {
      const rows = await database.publicRunUpload.findMany({ where: { uploaderKey }, orderBy: { createdAt: "desc" }, take: 500, select: { run: { select: { runRef: true } } } });
      return rows.map((row) => row.run.runRef);
    }
  };
}

// Sharing-enabled guilds (GuildSettings.publicDungeonRuns): their valid completed runs, as the bot
// already stored and checked them, go through the same public checks under "guild:<id>".
export async function publishGuildRuns(database: PrismaClient, store: PublicRunStore = prismaPublicRunStore(database), now = new Date()): Promise<number> {
  const guilds = await database.guildSettings.findMany({ where: { publicDungeonRuns: true }, select: { guildId: true, publicDungeonRunsSince: true } });
  let published = 0;
  for (const { guildId, publicDungeonRunsSince } of guilds) {
    const uploaderKey = `guild:${guildId}`;
    const known = new Set(await store.storedRefs(uploaderKey));
    const rows = await database.dungeonRun.findMany({
      where: {
        guildId, valid: true, state: "COMPLETED",
        endedAt: { gte: new Date(now.getTime() - PUBLIC_LIMITS.maxAgeDays * 86_400_000) },
        ...(publicDungeonRunsSince ? { startedAt: { gte: publicDungeonRunsSince } } : {})
      },
      orderBy: { endedAt: "desc" }, take: 200,
      include: { players: { include: { member: { select: { characters: { select: { name: true, realm: true } } } } } } }
    });
    const runs = rows.filter((row) => !known.has(row.runRef) && row.startedAt && row.endedAt).map((row) => {
      const levels = new Map(((row.competitionData as { players?: { name: string; level: number | null; minLevel?: number | null }[] } | null)?.players ?? []).map((p) => [key(p.name), p]));
      return {
        id: row.runRef, protocolVersion: row.protocolVersion, state: row.state, instanceId: row.instanceId, name: row.dungeonName, difficultyId: row.difficultyId,
        startedAt: Math.floor(row.startedAt!.getTime() / 1000), endedAt: Math.floor(row.endedAt!.getTime() / 1000), reporters: row.reporters,
        // completedBy may hold an older addon's end reason (up to 80 characters); uploads allow 40.
        ...(row.recorder ? { recorder: row.recorder } : {}), ...(row.completedBy ? { completedBy: row.completedBy.slice(0, 40) } : {}),
        ...(row.reporterNames.length ? { reporterNames: row.reporterNames.slice(0, 10) } : {}),
        encounters: (row.competitionData as { encounters?: unknown[] } | null)?.encounters ?? [],
        players: row.players.map((player) => {
          const seen = levels.get(key(player.character));
          return {
            character: player.character,
            realm: player.member?.characters.find((character) => key(character.name) === key(player.character))?.realm ?? "-",
            ...(player.class ? { class: player.class } : {}), ...(player.role ? { role: player.role } : {}),
            ...(seen?.level ? { level: seen.level } : {}), ...(seen?.minLevel ? { minLevel: seen.minLevel } : {}),
            deaths: player.deaths, presentSec: player.presentSec, inGuild: player.inGuild
          };
        })
      };
    });
    if (!runs.length) continue;
    for (let start = 0; start < runs.length; start += PUBLIC_LIMITS.runsPerUpload) {
      const result = await ingestPublicRuns(store, { uploaderKey, character: null, source: "guild", runs: runs.slice(start, start + PUBLIC_LIMITS.runsPerUpload) }, now);
      published += result.accepted.length + result.confirmed.length;
    }
  }
  return published;
}
