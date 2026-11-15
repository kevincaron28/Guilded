import type { PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { characterKey } from "../../companion/character-identity.mjs";
import { dungeonRunSchema } from "./dungeon-rules.js";
import { ingestRelayedRuns } from "./relay-public.js";
import { integrityConfig } from "./run-integrity-config.js";
import type { PublicRunStore } from "./public-runs.js";

// A dungeon run carried for a party with no companion at all (9.3.3). Each player's addon keeps its own finished run and whispers it to a
// carrier met later (Carry.lua, kind "run"). Owner decision (14 November 2026): one report is enough evidence, so a single carried statement is
// ranked like the statement of any single unsigned reporter. It goes through the relay lane (ingestRelayedRuns) with its checks and limits:
//   - the author must be a player of the run, and the carrier must not have played in it (own runs are the carrier's own upload's business);
//   - the run is placed by the first statement that passes; a later statement of the same run (same instance and run id) can only confirm it:
//     the public lane keeps the placed run when a later statement disagrees, and the refusal is logged for review (scores are never changed);
//   - floods are bounded by server-side limits (run-integrity-config.ts): rows per carrier and run, signed and unsigned carriers counted apart,
//     and distinct runs per carrier per day.
// Nothing here is member-visible. A carrier is told a record was dealt with (receipt) only when the run was placed or is a true duplicate;
// every refusal is logged with its reason.

/** Finished rows are deleted after this many days. */
const KEEP_DAYS = 30;
/** The cleanup runs at most this often. */
const CLEANUP_EVERY_MS = 10 * 60_000;
const lastCleanup = new WeakMap<object, number>();

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

export interface RunPlacement {
  store: PublicRunStore;
  /** Called with the runs placed on the public boards (the guilds with a member in them get a copy). */
  onPlaced?: ((runs: unknown[]) => void) | undefined;
}

/**
 * Places one carried run. Returns true when the carrier may be told the record was dealt with (the run was placed, confirmed or already known,
 * or it is the carrier's own run), false when it was refused or could not be placed now (logged, not receipted). `refuse` notes a refusal
 * against the carrier's day.
 */
export async function placeCarriedRun(database: PrismaClient, input: { carrier: string; carrierKeys: ReadonlySet<string>; key: string; author: string; data: unknown; now: Date; relay?: RunPlacement | undefined },
  refuse: (reason: string, status?: string) => Promise<void>): Promise<boolean> {
  const unpacked = unpackCarriedRun(input.data);
  if (!unpacked) { await refuse("bad-run-data"); return false; }
  const authorName = lower(input.author.split("-")[0] ?? input.author);
  if (!unpacked.players.some((name) => lower(name) === authorName)) { await refuse("author-not-in-run"); return false; }
  // The carrier played in it: its own upload reports that run, a carried copy of it is not a second voice.
  if (unpacked.players.some((name) => input.carrierKeys.has(lower(name)))) { await refuse("carrier played in it", "own"); return true; }
  const authorKey = characterKey(authorName, "");
  // Filed per carrier: a record another carrier handed in cannot make this one look known.
  const storedKey = `${input.key}@${input.carrier}`.slice(0, 200);
  const existing = await database.carriedRecord.findUnique({ where: { kind_authorKey_key: { kind: "run", authorKey, key: storedKey } }, select: { status: true } });
  if (existing && (existing.status === "applied" || existing.status === "own")) return true;
  if (!input.relay) { await refuse("no-public-store"); return false; }

  const config = integrityConfig();
  const signed = input.carrier.startsWith("member:");
  const dayStart = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()));
  const { runKey } = unpacked;
  if (await database.carriedRecord.count({ where: { kind: "run", runKey, carrier: input.carrier } }) >= config.carriedRunRowsPerCarrierRun) { await refuse("carrier-run-cap"); return false; }
  // Signed and unsigned carriers are counted apart: junk from cheap unsigned devices cannot use up the room of signed members.
  const rowsForRun = await database.carriedRecord.count({ where: { kind: "run", runKey, carrier: { startsWith: signed ? "member:" : "device:" } } });
  if (rowsForRun >= (signed ? config.carriedRunRowsPerRun : config.carriedRunRowsPerRunDevice)) { await refuse("run-cap"); return false; }
  const keysToday = await database.carriedRecord.findMany({ where: { kind: "run", carrier: input.carrier, createdAt: { gte: dayStart } }, distinct: ["runKey"], select: { runKey: true }, take: 1000 });
  const dayCap = signed ? config.carriedRunKeysPerDay : config.carriedRunKeysPerDayDevice;
  if (keysToday.length >= dayCap && !keysToday.some((row) => row.runKey === runKey)) { await refuse("carrier-day-cap"); return false; }

  const name = input.author.split("-")[0] ?? input.author;
  const result = await ingestRelayedRuns(input.relay.store, { carrier: input.carrier, carrierKeys: input.carrierKeys, runs: [{ ...unpacked.run, recorder: name, reporterNames: [name] }], now: input.now,
    ...(input.relay.onPlaced ? { onPlaced: input.relay.onPlaced } : {}) });
  if (result.published < 1) {
    // Held by a plausibility check, over the day's limit, or a different result than the run already placed (which stays as it is): for review.
    await refuse("not-placed (held, over a limit, or differs from the run already placed)");
    return false;
  }
  try {
    await database.carriedRecord.create({ data: { kind: "run", key: storedKey, author: input.author.slice(0, 80), authorKey: authorKey.slice(0, 160), carrier: input.carrier, status: "applied", runKey } });
  } catch (error) {
    // A rejected row of the same record is already filed; it is now applied.
    if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    await database.carriedRecord.updateMany({ where: { kind: "run", authorKey, key: storedKey }, data: { status: "applied", runKey } });
  }
  console.info(`Carried run ${runKey.slice(0, 50)} from ${input.author.slice(0, 40)} via ${input.carrier}: placed`);
  return true;
}

/** Deletes finished run rows after KEEP_DAYS (at most every few minutes). Never throws. */
export async function cleanCarriedRuns(database: PrismaClient, now: Date): Promise<void> {
  try {
    const last = lastCleanup.get(database);
    if (last !== undefined && now.getTime() - last < CLEANUP_EVERY_MS) return;
    lastCleanup.set(database, now.getTime());
    await database.carriedRecord.deleteMany({ where: { kind: "run", createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } } });
  } catch (error) {
    console.error(`Carried runs not cleaned: ${error instanceof Error ? error.message : String(error)}`);
  }
}
