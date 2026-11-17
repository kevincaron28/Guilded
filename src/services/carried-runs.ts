import type { PrismaClient } from "../generated/prisma/client.js";
import { z } from "zod";
import { characterKey } from "../../companion/character-identity.mjs";
import { dungeonRunSchema, type DungeonRunInput } from "./dungeon-rules.js";
import { ingestRelayedRuns, relayWouldPlace } from "./relay-public.js";
import { routesOfInstance } from "./dungeon-bosses.js";
import { integrityConfig } from "./run-integrity-config.js";
import { findSameRun, sameDetails, summarize, type PublicRunStore } from "./public-runs.js";

// A dungeon run carried for a party with no companion at all (9.3.3). Each player's addon keeps its own finished run and whispers it to a
// carrier met later (Carry.lua, kind "run"). Owner decision (14 November 2026): one report is enough evidence, so a single carried statement is
// ranked like the statement of any single unsigned reporter. It goes through the relay lane (ingestRelayedRuns) with its checks and limits:
//   - the author must be a player of the run, and the carrier must not have played in it (own runs are the carrier's own upload's business);
//   - a statement's run id (QG-date-time-name) must name a player of the run (its author, or another player in the same party: a relayed copy when
//     the id's owner never uploads) and carry a time close to the run's start, so an outsider cannot occupy the id of a run he was not in; a
//     statement that fails is refused and receipted (never retried);
//   - the first statement that passes places the run and a placed run is never changed by a later statement (a repeat is a receipted duplicate, a
//     different result is logged for review). The one exception: a run placed only by other players' relayed copies gives way, once, to its own
//     recorder's statement when that disagrees (logged);
//   - floods are bounded by server-side limits (run-integrity-config.ts): rows per carrier and run, signed and unsigned carriers counted apart,
//     and distinct runs per carrier per day.
// Nothing here is member-visible. A carrier is told a record was dealt with (receipt) only when the run was placed or is a true duplicate;
// every refusal is logged with its reason.

/** How far the time in the run id may be from the run's start (seconds). */
const ID_TIME_WINDOW = 600;
/** A statement held by a check is retried for this many days, then closed. */
const HELD_RETRY_DAYS = 2;
/** Finished rows are deleted after this many days. */
const KEEP_DAYS = 30;
/** The cleanup runs at most this often. */
const CLEANUP_EVERY_MS = 10 * 60_000;
/** Rows of copies one carrier may file per day (more are still receipted, just not stored). */
const COPY_ROWS_PER_DAY = 60;
const lastCleanup = new WeakMap<object, number>();

const lower = (text: string) => text.trim().normalize("NFC").toLowerCase();
const text = (max: number) => z.string().max(max);

/** What Carry.lua sends: one flat record (no nesting in the whisper format). Players are "name;class;role;level;seconds;deaths". */
const carriedRunSchema = z.object({
  id: text(100).min(3), i: z.number().int().positive(), d: z.number().int().nonnegative().max(50), st: z.number().int().positive(), en: z.number().int().positive(),
  cb: text(40).optional(), nm: text(100).optional(), ev: text(400).optional(),
  // (9.3.8) The recorder's presence proof, all optional: the run's observation, the native boss kills, and one observation per player (see Carry.lua).
  ig: text(160).optional(), ns: text(200).optional(),
  q1: text(900).optional(), q2: text(900).optional(), q3: text(900).optional(), q4: text(900).optional(), q5: text(900).optional(),
  p1: text(160).optional(), p2: text(160).optional(), p3: text(160).optional(), p4: text(160).optional(), p5: text(160).optional()
});

const ROLES: Record<string, "TANK" | "HEALER" | "DPS"> = { T: "TANK", H: "HEALER", D: "DPS" };
/** One player's observation ("known;unknown;role;mixed;gap.length/gap.length"), or undefined when it is not a consistent one (the run is then just not proven for that player). */
function unpackObservation(packed: string | undefined, startedAt: number): Record<string, unknown> | undefined {
  if (!packed) return undefined;
  const parts = packed.split(";");
  if (parts.length !== 5) return undefined;
  const [known, unknown, role, mixed, spans] = parts as [string, string, string, string, string];
  const knownIntervals: [number, number][] = [];
  let cursor = startedAt;
  for (const token of spans.split("/").filter(Boolean)) {
    const match = /^(-?\d{1,6})\.(\d{1,6})$/.exec(token);
    if (!match || knownIntervals.length >= 64) return undefined;
    const from = cursor + Number(match[1]), to = from + Number(match[2]);
    if (!(from > 0) || to <= from) return undefined;
    knownIntervals.push([from, to]);
    cursor = to;
  }
  const knownSec = Number(known), unknownSec = Number(unknown);
  if (!knownIntervals.length || !Number.isInteger(knownSec) || !Number.isInteger(unknownSec) || knownSec < 0 || unknownSec < 0 || (mixed !== "0" && mixed !== "1")) return undefined;
  return { knownSec, unknownSec, ...(ROLES[role] ? { lockedRole: ROLES[role] } : {}), mixedRole: mixed === "1", knownIntervals, basis: "self" };
}

/** The run's observation ("observer;trigger;detected;combat;continuous;witness", times from the run's start), or undefined. */
function unpackRunObservation(packed: string | undefined, startedAt: number): Record<string, unknown> | undefined {
  if (!packed) return undefined;
  const parts = packed.split(";");
  if (parts.length !== 6) return undefined;
  const [observer, trigger, detected, combat, continuous, witness] = parts as [string, string, string, string, string, string];
  const detectedAt = startedAt + Number(detected), combatAt = startedAt + Number(combat);
  if (!observer.trim() || (trigger !== "f" && trigger !== "p") || !Number.isInteger(detectedAt) || !Number.isInteger(combatAt) || detectedAt <= 0 || combatAt <= 0) return undefined;
  return { version: 2, startWitness: witness === "n" ? "native-reset" : "unknown", observer: observer.trim().slice(0, 100), detectedAt, combatAt, startTrigger: trigger === "p" ? "peer" : "first combat", continuous: continuous === "1" };
}

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
  // The presence proof, when the addon sent one: the recorder's observation of the run and of each player. A malformed piece is left out, never refused.
  const observations = [record.q1, record.q2, record.q3, record.q4, record.q5];
  const integrity = unpackRunObservation(record.ig, record.st);
  if (integrity) players.forEach((player, index) => { const seen = unpackObservation(observations[index], record.st); if (seen) player["integrity"] = seen; });
  // The wire record carries boss ids and times, no names. A dungeon with several routes on one map (Scarlet Monastery's four wings) is told apart
  // by the names of its bosses, exactly as for a companion-uploaded run, so each kill gets the name the bot knows for that id on this map.
  const knownBosses = routesOfInstance(record.i).flatMap((route) => route.bosses);
  const native = new Set((record.ns ?? "").split(",").filter(Boolean).slice(0, 12));
  const encounters: { id: number; success: true; at: number; name?: string; source?: "native" }[] = [];
  for (const piece of (record.ev ?? "").split(",").filter(Boolean).slice(0, 12)) {
    const [id, at] = piece.split(":").map(Number);
    if (!Number.isInteger(id) || !Number.isInteger(at) || id! <= 0 || at! <= 0) return null;
    const name = knownBosses.find((boss) => boss.ids.includes(id!))?.name;
    encounters.push({ id: id!, success: true, at: at!, ...(name ? { name } : {}), ...(integrity && native.has(piece) ? { source: "native" as const } : {}) });
  }
  const run = {
    gameEdition: "forever", id: record.id, protocolVersion: 1, state: "COMPLETED", instanceId: record.i, name: record.nm?.trim() || `Instance ${record.i}`,
    difficultyId: record.d, startedAt: record.st, endedAt: record.en, ...(record.cb ? { completedBy: record.cb } : {}), reporters: 1, encounters, players,
    ...(integrity ? { integrity } : {})
  };
  const checked = dungeonRunSchema.safeParse(run);
  if (!checked.success) return null;
  return { run, runKey: `${record.i}:${record.id}`, players: players.map((player) => String(player["character"])) };
}

/** The recorder's first name and the start time an addon-made run id (QG-YYYYMMDD-HHMMSS-name) carries, or null for any other id. */
export function parseRunId(id: string): { at: number; recorder: string } | null {
  const match = /^QG-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/.exec(id);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, recorder] = match as unknown as [string, string, string, string, string, string, string, string];
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000;
  return Number.isFinite(at) ? { at, recorder: lower(recorder.split("-")[0] ?? recorder) } : null;
}

export interface RunPlacement {
  store: PublicRunStore;
  /** Called with the runs placed on the public boards (the guilds with a member in them get a copy). */
  onPlaced?: ((runs: unknown[]) => void) | undefined;
}

/**
 * Places one carried run. Returns true when the carrier may be told the record was dealt with: the run was placed, it is a duplicate of a run
 * already placed, it is the carrier's own run, or the statement can never be accepted (malformed, or its author does not own the run id). Returns
 * false when it could not be placed now (a limit, a plausibility hold): logged, not receipted, sent again later. `refuse` notes a refusal against
 * the carrier's day.
 */
export async function placeCarriedRun(database: PrismaClient, input: { carrier: string; carrierKeys: ReadonlySet<string>; key: string; author: string; data: unknown; now: Date; relay?: RunPlacement | undefined },
  refuse: (reason: string, status?: string) => Promise<void>): Promise<boolean> {
  const unpacked = unpackCarriedRun(input.data);
  if (!unpacked) { await refuse("bad-run-data"); return true; }
  const authorName = lower(input.author.split("-")[0] ?? input.author);
  if (!unpacked.players.some((name) => lower(name) === authorName)) { await refuse("author-not-in-run"); return true; }
  // The run id belongs to the player who recorded it: its name is the author's and its time is the run's start.
  // A statement may also carry the id of another player of the same run (the id's owner may never upload): it is then a relayed copy of that
  // run under every check below. An id naming someone who is not in the party stays refused for good.
  const claimed = parseRunId(String(unpacked.run["id"]));
  if (!claimed) { await refuse("run-id-not-the-authors"); return true; }
  if (claimed.recorder !== authorName && !unpacked.players.some((name) => lower(name.split("-")[0] ?? name) === claimed.recorder)) { await refuse("run-id-not-in-the-party"); return true; }
  if (Math.abs(claimed.at - Number(unpacked.run["startedAt"])) > ID_TIME_WINDOW) { await refuse("run-id-time-mismatch"); return true; }
  // The carrier played in it: its own upload reports that run, a carried copy of it is not a second voice.
  if (unpacked.players.some((name) => input.carrierKeys.has(lower(name)))) { await refuse("carrier played in it", "own"); return true; }
  const authorKey = characterKey(authorName, "");
  const name = input.author.split("-")[0] ?? input.author;
  // Filed per run and carrier: the same run sent again under another record key is the same row, and another carrier's copy cannot hide this one.
  const storedKey = `${unpacked.runKey}@${input.carrier}`.slice(0, 200);
  const existing = await database.carriedRecord.findUnique({ where: { kind_authorKey_key: { kind: "run", authorKey, key: storedKey } }, select: { status: true, createdAt: true } });
  if (existing && (existing.status === "applied" || existing.status === "copy" || existing.status === "own" || existing.status === "differs" || existing.status === "refused")) return true;
  // A statement held by a check is sent again for a while; then it is closed for good (receipted as permanently refused, logged).
  // (A refusal is filed under the record's own key.)
  const filed = (await database.carriedRecord.findMany({ where: { kind: "run", key: input.key, carrier: input.carrier }, select: { status: true, createdAt: true }, take: 5 }));
  // Closed for good: sent again, it is receipted at once (it never re-enters the flow).
  if (filed.some((row) => row.status === "refused")) return true;
  const held = filed.find((row) => row.status === "held");
  if (held && input.now.getTime() - held.createdAt.getTime() > HELD_RETRY_DAYS * 86_400_000) {
    await database.carriedRecord.updateMany({ where: { kind: "run", key: input.key, carrier: input.carrier, status: "held" }, data: { status: "refused" } });
    console.info(`Carried run ${unpacked.runKey.slice(0, 50)} via ${input.carrier}: still held after ${HELD_RETRY_DAYS} days, closed as permanently refused`);
    return true;
  }
  if (!input.relay) { await refuse("no-public-store"); return false; }
  const { store } = input.relay;
  // The limits (server configuration), checked before anything is stored. A statement over a limit is not placed, and a repeat of a placed run is
  // answered without a row of its own.
  const { runKey } = unpacked;
  const summary = summarize(dungeonRunSchema.parse(unpacked.run) as DungeonRunInput, input.now);
  // Files this statement's row (one per run and carrier): what became of it, visible to the owner.
  const file = async (status: string) => {
    const data = { kind: "run", key: storedKey, author: input.author.slice(0, 80), authorKey: authorKey.slice(0, 160), carrier: input.carrier, status, runKey };
    try { await database.carriedRecord.create({ data }); }
    catch (error) {
      if ((error as { code?: string } | null)?.code !== "P2002") throw error;
      await database.carriedRecord.updateMany({ where: { kind: "run", authorKey, key: storedKey }, data: { status, runKey } });
    }
  };
  // The run on the boards this statement is about: the same run id, or another recorder's copy of the same real run.
  let target = await store.findRun(runKey);
  const near = !target;
  if (near) target = await findSameRun(store, summary).catch(() => null);
  let backup: unknown = null;
  let replaced: { key: string; text: string } | null = null;
  const differs = target ? !sameDetails(target, summary) : false;
  // A statement that says the same as a run already placed (every recorder's copy of one real run) costs the carrier nothing against its day:
  // it is filed as a "copy", which the daily count of distinct runs leaves out (a party of five is one run, not five).
  const copy = !!target && !differs;
  const capReason = await limitReached(database, input.carrier, runKey, input.now, copy);
  if (target) {
    if (copy) {
      // The same thing said again: a confirmation (receipted, no second run). Rows of copies are bounded per carrier and day.
      const copiesToday = await database.carriedRecord.count({ where: { kind: "run", carrier: input.carrier, status: "copy", createdAt: { gte: dayStartOf(input.now) } } });
      if (!capReason && copiesToday < COPY_ROWS_PER_DAY) await file("copy");
      if (near) console.info(`Carried run ${runKey.slice(0, 50)} via ${input.carrier}: a copy of a run already placed`);
      return true;
    }
    // A placed run is never changed by a later statement, with one exception: a run that only other players' relayed copies placed gives way, once,
    // to the statement of the recorder whose run id it should have been. The statement must be placeable afterwards (checked before anything is removed).
    const placedKey = target.runKey ?? runKey;
    const placedRecorder = parseRunId(placedKey.slice(placedKey.indexOf(":") + 1))?.recorder;
    const placedByRecorder = placedRecorder ? await database.carriedRecord.count({ where: { kind: "run", runKey: placedKey, authorKey: characterKey(placedRecorder, ""), status: "applied" } }) : 0;
    // Rows are deleted after KEEP_DAYS, which must never re-open the one replacement of an old run: a run that old, or one replaced before, is final.
    const replacedBefore = await database.carriedRecord.count({ where: { kind: "replaced-run", runKey: placedKey } });
    const oldRun = input.now.getTime() - target.startedAt.getTime() > (KEEP_DAYS - 5) * 86_400_000;
    const eligible = !placedByRecorder && !replacedBefore && !oldRun && target.uploaders.length > 0 && target.uploaders.every((uploader) => uploader.startsWith("relay:")) && !!store.discardRelayRun;
    const wouldPlace = eligible ? await relayWouldPlace(store, { carrier: input.carrier, run: { ...unpacked.run, recorder: name, reporterNames: [name] }, now: input.now }) : "not-applicable";
    if (eligible && wouldPlace !== null) { await refuse(`replacement-not-placed (${wouldPlace})`, "held"); return false; }
    if (!eligible) {
      // Another statement says something else and the placed run stays: receipted and recorded so it is never silently lost.
      console.info(`Carried run ${runKey.slice(0, 50)} via ${input.carrier}: differs from the run already placed, which stays (for review)`);
      if (!capReason) await file("differs");
      return true;
    }
    backup = store.relayRunBackup ? await store.relayRunBackup(target.id).catch(() => null) : null;
    if (!await store.discardRelayRun!(target.id)) { if (!capReason) await file("differs"); return true; }
    replaced = { key: placedKey, text: `${target.durationSec}s bosses ${target.encounters.map((boss) => boss.id).join(",")}` };
    console.info(`Carried run ${runKey.slice(0, 50)}: the recorder's statement replaces a run placed by other players' relayed copies (the original: ${replaced.key.slice(0, 60)}, ${replaced.text})`);
  }

  // The original is put back only when nothing of this statement is on the boards (an error after the run was created must not leave two rows).
  const putBack = async () => {
    if (!backup || !store.restoreRelayRun) return;
    try {
      // A lookup that fails is not "nothing there": the original is not put back then (it could duplicate a run), and the owner sees why.
      if (await store.findRun(runKey) || await findSameRun(store, summary)) return;
      await store.restoreRelayRun(backup);
    } catch (error) { console.error(`Carried run ${runKey.slice(0, 50)}: the replaced run was not put back: ${error instanceof Error ? error.message : String(error)}`); }
  };
  if (capReason) { await putBack(); await refuse(capReason); return false; }

  let result: Awaited<ReturnType<typeof ingestRelayedRuns>>;
  try {
    result = await ingestRelayedRuns(store, { carrier: input.carrier, carrierKeys: input.carrierKeys, runs: [{ ...unpacked.run, recorder: name, reporterNames: [name] }], now: input.now, skipNearMatch: true,
      ...(input.relay.onPlaced ? { onPlaced: input.relay.onPlaced } : {}) });
  } catch (error) { await putBack(); throw error; }
  if (result.published < 1 && result.known < 1) {
    // Held by a plausibility check or over the day's limit: the original run (if one was removed) is put back. Sent again for a while, then closed.
    await putBack();
    await refuse(`not-placed (${result.rejected[0]?.reason ?? "held by a check or over a limit"})`, "held");
    return false;
  }
  await file("applied");
  // A durable note of what was replaced (not deleted with the run rows), for the owner.
  if (replaced) await database.carriedRecord.create({ data: { kind: "replaced-run", key: replaced.key.slice(0, 120), author: replaced.text.slice(0, 80), authorKey: authorKey.slice(0, 160), carrier: input.carrier, status: "replaced", runKey } }).catch((error: unknown) => { if ((error as { code?: string } | null)?.code !== "P2002") console.error(`Replaced run note not saved: ${error instanceof Error ? error.message : String(error)}`); });
  console.info(`Carried run ${runKey.slice(0, 50)} from ${input.author.slice(0, 40)} via ${input.carrier}: placed`);
  return true;
}

const dayStartOf = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
/** Carriers whose day cap was already logged today ("carrier|day"), so the journal says it once. */
const capLogged = new Set<string>();

/** The name of the limit this carrier has reached for this run, or null. Signed and unsigned carriers are counted apart. A copy of a run already placed is held to the row limits only: it never counts as a run of the day. */
async function limitReached(database: PrismaClient, carrier: string, runKey: string, now: Date, copy = false): Promise<string | null> {
  const config = integrityConfig();
  const signed = carrier.startsWith("member:");
  const dayStart = dayStartOf(now);
  if (await database.carriedRecord.count({ where: { kind: "run", runKey, carrier } }) >= config.carriedRunRowsPerCarrierRun) return "carrier-run-cap";
  const rowsForRun = await database.carriedRecord.count({ where: { kind: "run", runKey, carrier: { startsWith: signed ? "member:" : "device:" } } });
  if (rowsForRun >= (signed ? config.carriedRunRowsPerRun : config.carriedRunRowsPerRunDevice)) return "run-cap";
  if (copy) return null;
  const rowsToday = await database.carriedRecord.findMany({ where: { kind: "run", carrier, createdAt: { gte: dayStart } }, select: { runKey: true, status: true }, take: 1000 });
  const keysToday = new Set(rowsToday.filter((row) => row.status !== "copy").map((row) => row.runKey));
  const limit = signed ? config.carriedRunKeysPerDay : config.carriedRunKeysPerDayDevice;
  if (keysToday.size >= limit && !keysToday.has(runKey)) {
    const logged = `${carrier}|${dayStart.getTime()}`;
    if (!capLogged.has(logged)) {
      for (const old of capLogged) if (!old.endsWith(`|${dayStart.getTime()}`)) capLogged.delete(old);
      capLogged.add(logged);
      console.info(`Carried runs: ${carrier} reached its limit of ${limit} distinct runs today; further runs wait until tomorrow (copies of a placed run are free)`);
    }
    return "carrier-day-cap";
  }
  return null;
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
