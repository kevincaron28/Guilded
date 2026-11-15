import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { characterKey } from "../../companion/character-identity.mjs";
import { dungeonRunSchema } from "./dungeon-rules.js";
import { ingestRelayedRuns } from "./relay-public.js";
import type { PublicRunStore } from "./public-runs.js";

// A dungeon run carried for a party with no companion at all (9.3.3). Each player's addon keeps its own finished run and whispers it to a
// carrier met later (Carry.lua, kind "run"). The origin of the record is only the carrier's word, so it is HELD: stored with no effect on
// any board, guild, season or card. It is released only
//   - by an independent report of the same run that did not come through a carrier (the run is then on the boards on its own evidence), or
//   - by statements of two different players, carried by two different signed-in members (never on unsigned carried reports alone).
// A held run that nobody released within HELD_DAYS is dropped.

export const HELD_DAYS = 14;
/** Finished rows (released, expired, refused) are deleted after this many days. */
const KEEP_DAYS = 30;
/** Start and end times of two statements of one run may differ by this much (seconds). */
const TIME_TOLERANCE = 120;
/** The held-run sweep runs at most this often. */
const SWEEP_EVERY_MS = 10 * 60_000;
/** Held rows kept per carrier and run, and per run overall; more are answered but not stored (they could only crowd out honest ones). */
const PER_CARRIER_RUN = 3;
const PER_RUN = 40;
const lastSweep = new WeakMap<object, number>();
/** Rows looked at per sweep for an independent report that arrived after the carried one. */
const SWEEP_LIMIT = 10;

const lower = (text: string) => text.trim().normalize("NFC").toLowerCase();
const text = (max: number) => z.string().max(max);

/** What Carry.lua sends: one flat record (no nesting in the whisper format). Players are "name;class;role;level;seconds;deaths". */
const carriedRunSchema = z.object({
  id: text(100).min(3), i: z.number().int().positive(), d: z.number().int().nonnegative().max(50), st: z.number().int().positive(), en: z.number().int().positive(),
  cb: text(40).optional(), nm: text(100).optional(), ev: text(400).optional(),
  p1: text(160).optional(), p2: text(160).optional(), p3: text(160).optional(), p4: text(160).optional(), p5: text(160).optional()
});

export interface UnpackedRun { run: Record<string, unknown>; runKey: string; players: string[] }

/** The run a carried record describes, in the shape the public lane reads, or null when it is not a well-formed finished run of a small party. */
export function unpackCarriedRun(data: unknown): UnpackedRun | null {
  const parsed = carriedRunSchema.safeParse(data);
  if (!parsed.success) return null;
  const record = parsed.data;
  const players: Record<string, unknown>[] = [];
  for (const packed of [record.p1, record.p2, record.p3, record.p4, record.p5]) {
    if (packed === undefined) continue;
    const parts = packed.split(";");
    if (parts.length !== 6 || !parts[0]?.trim()) return null;
    const [name, cls, role, level, present, deaths] = parts as [string, string, string, string, string, string];
    const levelNumber = Number(level), presentNumber = Number(present), deathNumber = Number(deaths);
    if (![levelNumber, presentNumber, deathNumber].every((value) => Number.isInteger(value) && value >= 0)) return null;
    players.push({ character: name.trim().slice(0, 40), realm: "Forever", class: cls.slice(0, 20) || undefined, role: role.slice(0, 10) || undefined,
      ...(levelNumber >= 1 && levelNumber <= 100 ? { level: levelNumber } : {}), presentSec: Math.min(presentNumber, 86_400), deaths: Math.min(deathNumber, 500) });
  }
  if (!players.length) return null;
  const encounters: { id: number; success: true; at: number }[] = [];
  for (const piece of (record.ev ?? "").split(",").filter(Boolean).slice(0, 12)) {
    const [id, at] = piece.split(":").map(Number);
    if (!Number.isInteger(id) || !Number.isInteger(at) || id! <= 0 || at! <= 0) return null;
    encounters.push({ id: id!, success: true, at: at! });
  }
  const run = {
    gameEdition: "forever", id: record.id, protocolVersion: 1, state: "COMPLETED", instanceId: record.i, name: record.nm?.trim() || `Instance ${record.i}`,
    difficultyId: record.d, startedAt: record.st, endedAt: record.en, ...(record.cb ? { completedBy: record.cb } : {}), reporters: 1, encounters, players
  };
  const checked = dungeonRunSchema.safeParse(run);
  if (!checked.success) return null;
  return { run, runKey: `${record.i}:${record.id}`, players: players.map((player) => String(player["character"])) };
}

export interface HeldRelease {
  store: PublicRunStore;
  /** Called with the runs placed on the public boards by a release (the guilds with a member in them get a copy). */
  onPlaced?: ((runs: unknown[]) => void) | undefined;
}

/**
 * Holds one carried run. Returns true when the carrier may be told the record was dealt with (held, refused or already known), false when
 * nothing could be stored (it is then sent again later). `refuse` notes a refusal against the carrier's day.
 */
export async function holdCarriedRun(database: PrismaClient, input: { carrier: string; carrierKeys: ReadonlySet<string>; key: string; author: string; data: unknown; now: Date; release?: HeldRelease | undefined },
  refuse: (reason: string, status?: string) => Promise<void>): Promise<boolean> {
  const unpacked = unpackCarriedRun(input.data);
  if (!unpacked) { await refuse("bad-run-data"); return true; }
  const authorName = lower(input.author.split("-")[0] ?? input.author);
  if (!unpacked.players.some((name) => lower(name) === authorName)) { await refuse("author-not-in-run"); return true; }
  const authorKey = characterKey(authorName, "");
  // Filed per carrier too: a forged record that squats a key cannot make the genuine record of the same key, carried by someone else, look known.
  const storedKey = `${input.key}@${input.carrier}`.slice(0, 200);
  const existing = await database.carriedRecord.findUnique({ where: { kind_authorKey_key: { kind: "run", authorKey, key: storedKey } }, select: { id: true } });
  if (existing) return true;
  // The carrier played in it: its own upload reports that run, a carried copy of it is not a second voice.
  if (unpacked.players.some((name) => input.carrierKeys.has(lower(name)))) { await refuse("carrier played in it", "own"); return true; }
  if (await database.carriedRecord.count({ where: { kind: "run", runKey: unpacked.runKey, carrier: input.carrier } }) >= PER_CARRIER_RUN
    || await database.carriedRecord.count({ where: { kind: "run", runKey: unpacked.runKey } }) >= PER_RUN) return true;
  try {
    await database.carriedRecord.create({ data: { kind: "run", key: storedKey, author: input.author.slice(0, 80), authorKey: authorKey.slice(0, 160), carrier: input.carrier, status: "held", runKey: unpacked.runKey, payload: unpacked.run as Prisma.InputJsonValue } });
  } catch (error) {
    // Two carriers handing in the same record at the same moment: the other one stored it.
    if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    return true;
  }
  console.info(`Carried run ${unpacked.runKey.slice(0, 50)} from ${input.author.slice(0, 40)} via ${input.carrier}: held`);
  if (input.release) await releaseHeldRuns(database, unpacked.runKey, input.release, input.now).catch((error: unknown) => console.error(`Held run ${unpacked.runKey.slice(0, 50)} not evaluated: ${error instanceof Error ? error.message : String(error)}`));
  return true;
}

/**
 * Looks at the held rows of one run and releases them when a rule is met. Nothing is public while a run is held; a release by an independent
 * report publishes nothing itself (that report already put the run on the boards on its own evidence).
 */
export async function releaseHeldRuns(database: PrismaClient, runKey: string, release: HeldRelease, now: Date): Promise<"none" | "independent" | "signed"> {
  const rows = await database.carriedRecord.findMany({ where: { kind: "run", runKey, status: "held" }, select: { id: true, carrier: true, authorKey: true, author: true, payload: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: PER_RUN });
  if (!rows.length) return "none";
  const ids = rows.map((row) => row.id);
  const stored = await release.store.findRun(runKey);
  // A stored run that only relayed copies made is not an independent report.
  if (stored && stored.uploaders.some((uploader) => !uploader.startsWith("relay:"))) {
    await database.carriedRecord.updateMany({ where: { id: { in: ids } }, data: { status: "released", payload: Prisma.DbNull } });
    return "independent";
  }
  // Only signed carriers can pair, and at most PER_CARRIER_RUN rows of one carrier count, so junk rows cannot push the honest ones out.
  const perCarrier = new Map<string, number>();
  const signed = rows.filter((row) => {
    if (!row.carrier.startsWith("member:")) return false;
    const seen = perCarrier.get(row.carrier) ?? 0;
    perCarrier.set(row.carrier, seen + 1);
    return seen < PER_CARRIER_RUN;
  });
  // Two statements count only as a pair: different carriers, different authors, each author a player of the run in both statements, and the
  // two statements agreeing on the run. A carrier's rows never pair with each other. The earlier statement of the first pair is published.
  for (const [index, first] of signed.entries()) {
    for (const second of signed.slice(index + 1)) {
      if (first.carrier === second.carrier || first.authorKey === second.authorKey) continue;
      const merged = mergeStatements(first, second);
      if (!merged) continue;
      const names = [first.author, second.author].map((author) => author.split("-")[0] ?? author).sort();
      const result = await ingestRelayedRuns(release.store, { carrier: [first.carrier, second.carrier].sort()[0]!, carrierKeys: new Set(), runs: [{ ...merged, recorder: names[0], reporterNames: names }], now, ...(release.onPlaced ? { onPlaced: release.onPlaced } : {}) });
      // Dealt with (placed, held by the plausibility checks, or over the carrier's day): the rows are no longer waiting.
      if (result.receipts.length) await database.carriedRecord.updateMany({ where: { id: { in: ids } }, data: { status: "released", payload: Prisma.DbNull } });
      return "signed";
    }
  }
  return "none";
}

interface Statement { author: string; authorKey: string; payload: unknown }
interface RunPlayer { character?: string; class?: string; role?: string; level?: number; presentSec?: number; deaths?: number }
interface RunShape { instanceId?: number; difficultyId?: number; startedAt?: number; endedAt?: number; completedBy?: string; encounters?: { id?: number; success?: boolean; at?: number }[]; players?: RunPlayer[]; [key: string]: unknown }
const asRun = (payload: unknown) => (payload && typeof payload === "object" ? payload as RunShape : null);
const nameOf = (player: RunPlayer) => lower(String(player.character ?? ""));
const same = (a: unknown, b: unknown) => (typeof a === "string" || typeof b === "string" ? lower(String(a ?? "")) === lower(String(b ?? "")) : a === b);

/**
 * The run both statements agree on, or null. Everything that is not a measurement must be equal; of the measurements the less favourable value is
 * published (the longer duration, the most deaths, the shortest time present), so one statement cannot improve a run. Symmetric: the order of the
 * two statements does not change the result.
 */
export function mergeStatements(a: Statement, b: Statement): Record<string, unknown> | null {
  const first = asRun(a.payload), second = asRun(b.payload);
  if (!first || !second) return null;
  if (first.instanceId !== second.instanceId || first.difficultyId !== second.difficultyId || !same(first.completedBy, second.completedBy)) return null;
  const { startedAt: startA, endedAt: endA } = first, { startedAt: startB, endedAt: endB } = second;
  if (typeof startA !== "number" || typeof startB !== "number" || typeof endA !== "number" || typeof endB !== "number") return null;
  if (Math.abs(startA - startB) > TIME_TOLERANCE || Math.abs(endA - endB) > TIME_TOLERANCE) return null;
  const bosses = (run: RunShape) => (run.encounters ?? []).map((encounter) => `${encounter.id}:${encounter.success ? 1 : 0}`).sort().join("|");
  if (bosses(first) !== bosses(second)) return null;
  const byName = (x: RunPlayer, y: RunPlayer) => nameOf(x).localeCompare(nameOf(y));
  const sortedA = [...(first.players ?? [])].sort(byName), sortedB = [...(second.players ?? [])].sort(byName);
  if (!sortedA.length || sortedA.length !== sortedB.length) return null;
  const players: RunPlayer[] = [];
  for (const [index, left] of sortedA.entries()) {
    const right = sortedB[index]!;
    if (nameOf(left) !== nameOf(right) || !same(left.class, right.class) || !same(left.role, right.role) || left.level !== right.level) return null;
    const spelled = String(left.character) <= String(right.character) ? left : right;
    players.push({ ...spelled, presentSec: Math.min(left.presentSec ?? 0, right.presentSec ?? 0), deaths: Math.max(left.deaths ?? 0, right.deaths ?? 0) });
  }
  for (const row of [a, b]) if (!players.some((player) => nameOf(player) === lower(row.author.split("-")[0] ?? row.author))) return null;
  const start = Math.min(startA, startB), duration = Math.max(endA - startA, endB - startB);
  const encounters = (first.encounters ?? []).map((encounter) => ({ ...encounter, at: Math.min(encounter.at ?? 0, (second.encounters ?? []).find((other) => other.id === encounter.id)?.at ?? Number.MAX_SAFE_INTEGER) }));
  // Anything else on the run (its name, edition, reporters) comes from the statement that sorts first, whichever arrived first.
  const base = JSON.stringify(first) <= JSON.stringify(second) ? first : second;
  return { ...base, startedAt: start, endedAt: start + duration, encounters, players };
}

/** Drops held runs nobody released, and releases the ones an independent report has since covered. Never throws. */
export async function sweepHeldRuns(database: PrismaClient, release: HeldRelease | undefined, now: Date): Promise<void> {
  try {
    const last = lastSweep.get(database);
    if (last !== undefined && now.getTime() - last < SWEEP_EVERY_MS) return;
    lastSweep.set(database, now.getTime());
    const cutoff = new Date(now.getTime() - HELD_DAYS * 86_400_000);
    await database.carriedRecord.updateMany({ where: { kind: "run", status: "held", createdAt: { lt: cutoff } }, data: { status: "expired", payload: Prisma.DbNull } });
    await database.carriedRecord.deleteMany({ where: { kind: "run", status: { not: "held" }, createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } } });
    if (!release) return;
    // Runs with a signed carrier are looked at first (they alone can be published), then the newest of the rest: junk runs cannot starve either.
    const signedKeys = await database.carriedRecord.findMany({ where: { kind: "run", status: "held", carrier: { startsWith: "member:" } }, distinct: ["runKey"], select: { runKey: true }, orderBy: { createdAt: "desc" }, take: SWEEP_LIMIT });
    const otherKeys = await database.carriedRecord.findMany({ where: { kind: "run", status: "held" }, distinct: ["runKey"], select: { runKey: true }, orderBy: { createdAt: "desc" }, take: SWEEP_LIMIT });
    for (const runKey of new Set([...signedKeys, ...otherKeys].map((row) => row.runKey))) if (runKey) await releaseHeldRuns(database, runKey, release, now);
  } catch (error) {
    console.error(`Held runs not swept: ${error instanceof Error ? error.message : String(error)}`);
  }
}
