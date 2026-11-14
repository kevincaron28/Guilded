import { publicRules, readRuleSnapshot } from "./public-score.js";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import { reconcileEvidenceAwards } from "./dungeon-evidence-awards.js";
import { reconcileSummaries, summarize } from "./public-runs.js";
import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { currentIntegrityPolicy, integrityRole, integrityWindowReason, withIntegrityWindow } from "./dungeon-integrity.js";
import { gameEditionOf } from "./game-edition.js";
import { addonName } from "./addon-name.js";
import { currentEdition } from "./edition-context.js";
import { bracketForLevel, leniencyOf, resolveNovemberRoute, validBracketedRules, validRouteRules } from "./dungeon-november-rules.js";
import { dungeonResetCutoff, predatesDungeonReset } from "./dungeon-reset.js";
import type { Prisma } from "../generated/prisma/client.js";
import { grantRunAchievements, type AchievementKey } from "./dungeon-achievements.js";
import { findCharacter } from "./character-match.js";
import { deathMapOf, mergeRunCells, outlineFor } from "./dungeon-map-grid.js";
import { cleanCharacterName, displayCharacterName } from "./character-display.js";
export { cleanCharacterName };

/** The name a run card shows: the guild's full name, keeping a real doubled last name ("Xaldin Xaldin") its own tables hold. */
export function runFullName(character: string, known: readonly { name: string; displayName?: string | null }[], party: readonly string[] = []): string {
  const names = known.flatMap(c => [c.displayName, c.name]);
  const first = character.trim().toLowerCase();
  const doubled = names.find(n => n && n.trim().replace(/\s+/g, " ").toLowerCase() === `${first} ${first}`);
  return doubled ? doubled.trim().replace(/\s+/g, " ") : cleanCharacterName(displayCharacterName(character, names, party));
}

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
  & Partial<Pick<Prisma.TransactionClient, "$executeRaw" | "dungeonMapGrid" | "dungeonRunReceipt">>;

interface LinkedCharacter { name: string; realm: string; memberId: string; spec?: string | null; discordId?: string | null; displayName?: string | null }

export interface DungeonImportResult {
  runRef: string;
  // Database id of the stored run (9.1: the dungeon post's Chronologie button looks the run up by it).
  runId?: string;
  dungeonName: string;
  // The dungeon's instance id (records and challenges are judged per dungeon and difficulty).
  instanceId?: number;
  difficultyId: number;
  state: string;
  valid: boolean;
  invalidReason?: string;
  durationSec: number | null;
  points: number;
  guildRecord: boolean;
  previousGuildBest: number | null;
  // Where this run's time places among the guild's record-eligible clears of the same route (1 = fastest); absent when not ranked.
  guildRank?: { rank: number; of: number };
  personalRecords: { character: string; previous: number; now: number }[];
  players: string[];
  // Sum of tracked deaths; null when no player's deaths were tracked.
  deaths: number | null;
  endedAt?: number;
  startedAt?: number;
  encounters?: DungeonRunInput["encounters"];
  // Where the party died (fractions of a map, per uiMapID); absent when the addons recorded none.
  deathPoints?: DungeonRunInput["deathPoints"];
  // The traced outline of the floor the card's death map draws (dungeon-map-grid.ts); absent until that floor has enough cells.
  mapOutline?: { map: number; cells: number[] };
  completedBy?: string;
  challenge?: DungeonRunInput["challenge"];
  ratingEnabled?: boolean;
  ratingSpeedBonus?: number;
  ratingVersion?: number;
  playerDetails?: { character: string; class?: string; role?: string; spec?: string; specSource?: "run" | "profile"; /** 9.3: the in-game guild the recorder's client showed for this player. Unverified display text. */ guild?: string; deaths: number | null; presentSec: number; points: number; ratingGain?: number; ratingTotal?: number; unrankedReason?: string; participationRecipient?: string; participationMode?: "none" | "completion" | "helper" | "full" }[];
  unlinked: string[];
  // Party names the addon flagged as guild members (UnitIsInMyGuild). Absent on results built before 8.5.
  inGuildPlayers?: string[];
  // Party character -> Discord user id for linked members (8.5: the run post mentions them, without a ping).
  mentions?: Record<string, string>;
  // Party character -> full "First Last" name where the stored name is only a first name.
  fullNames?: Record<string, string>;
  achievements: { character: string; key: AchievementKey }[];
  // 9.1: guild records and challenges this run set (dungeon-records.ts), attached after the import when callouts are on.
  highlights?: import("./dungeon-records.js").DungeonHighlightItem[];
}

export interface DungeonImportSummary {
  results: DungeonImportResult[];
  duplicates: number;
  malformed: number;
  // Every run ref this upload brought and what happened to it (9.0.8), saved as DungeonRunReceipt rows.
  receipts?: RunReceipt[];
  /** (9.3.2) The runs this import stored as completed and valid: other guilds with a member in them get a copy (cross-guild-runs.ts), after this import is saved. */
  shareable?: unknown[];
}

// "retry" (9.3): refused for a cause a later bot version can fix (the run data could not be read). It is NOT an acknowledgement:
// the standings and device answers leave it out of the accepted refs, so the addon keeps the run waiting and sends it again.
export const RETRY_OUTCOME = "retry";
export const RETRY_GIVE_UP_MS = 3 * 86_400_000;
export interface RunReceipt { runRef: string; outcome: "stored" | "copy" | "refused" | "retry"; reason: string | null; runId: string | null; state?: string | null; fresh?: boolean }

const RECEIPT_REASON_MAX = 80;
// Short, member-facing reasons the addon shows next to a run that earned nothing.
export function receiptReason(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, RECEIPT_REASON_MAX) : null;
}
const refOf = (raw: unknown): string | null => {
  const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
};

/**
 * Saves one receipt per run ref (9.0.8): the standings snapshot sends these refs back, so the addon
 * stops counting a run the bot received as "waiting", whether it was stored, a copy of a stored run,
 * or refused. A ref seen again only refreshes `seenAt`, keeping the first outcome and reason.
 */
export async function saveRunReceipts(tx: Partial<Pick<Prisma.TransactionClient, "dungeonRunReceipt">>, guildId: string, receipts: RunReceipt[], now = new Date()): Promise<void> {
  const table = tx.dungeonRunReceipt;
  if (!table || !receipts.length) return;
  // Batched (a whole upload's runs in three or four queries): this runs under the guild's import lock.
  // The first receipt of a ref wins (one upload can carry the same run twice).
  const first = new Map<string, RunReceipt>();
  for (const receipt of receipts) if (!first.has(receipt.runRef)) first.set(receipt.runRef, receipt);
  const refs = [...first.keys()];
  const previous = await table.findMany({ where: { guildId, runRef: { in: refs } }, select: { runRef: true, outcome: true, createdAt: true } });
  // A "retry" is bounded: a run still unreadable (or still waiting for a guildmate's copy) three days after its first retry is
  // refused for good, so an old addon does not resend it forever. The date of the first retry is the receipt's createdAt.
  const gaveUp = new Set(previous.filter((row) => row.outcome === RETRY_OUTCOME && row.createdAt && now.getTime() - row.createdAt.getTime() > RETRY_GIVE_UP_MS).map((row) => row.runRef));
  const rows = [...first.values()].map((row): RunReceipt => row.outcome === RETRY_OUTCOME && gaveUp.has(row.runRef)
    ? { ...row, outcome: "refused", reason: receiptReason(`${row.reason ?? "Not counted"}, gave up after 3 days`) } : row);
  const existing = new Set(previous.map((row) => row.runRef));
  const wasRetry = new Set(previous.filter((row) => row.outcome === RETRY_OUTCOME).map((row) => row.runRef));
  // A ref that waited as "retry" takes whatever it finally became (stored, copy, refused for good).
  const retried = new Set(previous.filter((row) => row.outcome === RETRY_OUTCOME).map((row) => row.runRef));
  const created = rows.filter((row) => !existing.has(row.runRef));
  if (created.length) await table.createMany({ skipDuplicates: true, data: created.map((row) => ({ guildId, runRef: row.runRef, outcome: row.outcome,
    state: row.state ?? null, reason: row.reason, runId: row.runId, createdAt: now, seenAt: now })) });
  const repeats = rows.filter((row) => existing.has(row.runRef) && !row.fresh && !(retried.has(row.runRef) && row.outcome !== RETRY_OUTCOME)).map((row) => row.runRef);
  if (repeats.length) await table.updateMany({ where: { guildId, runRef: { in: repeats } }, data: { seenAt: now } });
  // A newly stored (or recovered) run takes its new outcome and reason; a repeat only moves the date.
  for (const row of rows.filter((candidate) => existing.has(candidate.runRef) && (candidate.fresh || retried.has(candidate.runRef) && candidate.outcome !== RETRY_OUTCOME))) {
    await table.update({ where: { guildId_runRef: { guildId, runRef: row.runRef } },
      // A stored receipt turned into a retry starts the retry clock again (its createdAt is the first retry).
      data: { seenAt: now, outcome: row.outcome, state: row.state ?? null, reason: row.reason, runId: row.runId, ...(row.outcome === RETRY_OUTCOME && !wasRetry.has(row.runRef) ? { createdAt: now } : {}) } });
  }
}

// True when this exact observer report is already kept with the stored run (or no more are kept):
// sending it again changes nothing.
function alreadyReported(data: unknown, run: DungeonRunInput): boolean {
  const reports = (data as { observerReports?: unknown[] } | null)?.observerReports ?? [];
  if (reports.length >= 40) return true;
  const key = JSON.stringify({ ...run, mapCells: undefined });
  return reports.some((value) => { const parsed = dungeonRunSchema.safeParse(value); return parsed.success && JSON.stringify(parsed.data) === key; });
}

/**
 * 9.0.8: the companion sends every saved run on each upload, and the import holds the guild's lock
 * (shared with the leaderboard job and season rotation) while it works. Runs the bot already has are
 * answered from batched reads and skip the per-run work (map merge, season, copy search, history):
 * that work used to keep the lock for seconds and time out other transactions (P2028).
 * Still taken the long way: a COMPLETED recovery of a stored unfinished run, a new observer report
 * of a completed run, and a guildmate's copy that comes back in another state.
 */
async function knownRuns(tx: Tx, guildId: string, runs: DungeonRunInput[]): Promise<Map<string, RunReceipt>> {
  const known = new Map<string, RunReceipt>();
  const refs = [...new Set(runs.map((run) => run.id))];
  if (!refs.length) return known;
  const stored = new Map((await tx.dungeonRun.findMany({ where: { guildId, runRef: { in: refs } },
    select: { id: true, runRef: true, state: true, valid: true, invalidReason: true } })).map((row) => [row.runRef, row] as const));
  const reportable = runs.filter((run) => run.integrity?.observer && stored.get(run.id)?.valid && stored.get(run.id)?.state === "COMPLETED").map((run) => run.id);
  const reports = new Map(reportable.length ? (await tx.dungeonRun.findMany({ where: { guildId, runRef: { in: reportable } },
    select: { runRef: true, competitionData: true } })).map((row) => [row.runRef, row.competitionData] as const) : []);
  const copies = new Map(tx.dungeonRunReceipt ? (await tx.dungeonRunReceipt.findMany({ where: { guildId, runRef: { in: refs.filter((ref) => !stored.has(ref)) }, outcome: "copy" },
    select: { runRef: true, reason: true, runId: true, state: true } })).map((row) => [row.runRef, row] as const) : []);
  for (const run of runs) {
    if (known.has(run.id)) continue;
    const existing = stored.get(run.id);
    if (existing) {
      if (existing.state !== "COMPLETED" && run.state === "COMPLETED") continue;
      if (reports.has(run.id) && !alreadyReported(reports.get(run.id), run)) continue;
      known.set(run.id, { runRef: run.id, outcome: "stored", state: run.state, runId: existing.id,
        reason: receiptReason(existing.invalidReason ?? (existing.state === "COMPLETED" ? null : "Not completed")) });
      continue;
    }
    const copy = copies.get(run.id);
    if (copy && copy.state === run.state) known.set(run.id, { runRef: run.id, outcome: "copy", state: run.state, reason: copy.reason, runId: copy.runId });
  }
  return known;
}


// Why a run was dropped or earned nothing. Map ids, states and reasons only: no player names
// and no run references (those contain the recorder's character name).
export function logDungeonRun(reason: string, run: { instanceId?: unknown; difficultyId?: unknown; state?: unknown; gameEdition?: unknown; completedBy?: unknown; endReason?: unknown; encounters?: unknown } | null | undefined): void {
  const r = run ?? {};
  const encounters = Array.isArray(r.encounters) ? r.encounters.length : 0;
  console.info(`Dungeon run not scored: ${reason} (instance ${String(r.instanceId ?? "?")}, difficulty ${String(r.difficultyId ?? "?")}, `
    + `edition ${String(r.gameEdition ?? "?")}, state ${String(r.state ?? "?")}, ended by ${String(r.completedBy ?? r.endReason ?? "?")}, ${encounters} encounters)`);
}

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

const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** The first word of a character name, lowercased and without accents: "Hulke Hogan" and "Hulke" share the key "hulke". */
export function firstNameKey(name: string): string { return plain(name).split(" ")[0] ?? ""; }
// One row per character (case- and accent-insensitive). Observers can disagree on the realm ("-" vs a name),
// repeat a player, or know only a first name ("Hulke") where another knows the full one ("Hulke Hogan"): merge
// them, keeping the full name, the longest presence and any known details. A first-name-only entry merges into a
// full name only when exactly one full name with that first word is compatible (same class, or a class unknown);
// two different full names sharing a first name are two different people and stay apart.
/** The role a member held during the run: the one the addon locked while the run was active (the card must not show the role they swapped to afterwards), else the last group role it saw. */
function cardRole(player: { role?: string | null | undefined; integrity?: unknown }): string | undefined {
  return integrityRole(player.integrity) ?? dungeonRole(player.role) ?? undefined;
}

export function dedupeRunPlayers<P extends DungeonRunInput["players"][number]>(players: P[]): P[] {
  const combine = (seen: P, player: P): P => {
    const longer = (player.presentSec ?? 0) > (seen.presentSec ?? 0) ? player : seen;
    const other = longer === player ? seen : player;
    const merged = { ...other, ...Object.fromEntries(Object.entries(longer).filter(([, value]) => value !== undefined && value !== null)) } as P;
    if (seen.inGuild || player.inGuild) merged.inGuild = true;
    if (merged.deaths === undefined || merged.deaths === null) merged.deaths = seen.deaths ?? player.deaths;
    // Keep the fuller name.
    merged.character = seen.character.trim().split(/\s+/).length >= player.character.trim().split(/\s+/).length ? seen.character : player.character;
    return merged;
  };
  const byName = new Map<string, P>();
  for (const raw of players) {
    const player = { ...raw, character: cleanCharacterName(raw.character, raw.realm) } as P;
    const key = plain(player.character);
    const seen = byName.get(key);
    byName.set(key, seen ? combine(seen, player) : player);
  }
  const wordsOf = (player: P) => player.character.trim().split(/\s+/).length;
  const compatible = (a: P, b: P) => !a.class || !b.class || a.class.toUpperCase() === b.class.toUpperCase();
  const rows = [...byName.values()];
  const merged = new Set<P>();
  for (const short of rows.filter((row) => wordsOf(row) === 1)) {
    const candidates = rows.filter((row) => row !== short && !merged.has(row) && wordsOf(row) > 1 && firstNameKey(row.character) === firstNameKey(short.character) && compatible(row, short));
    // Another short name or a second compatible full name makes it ambiguous: leave everyone as reported.
    if (candidates.length !== 1) continue;
    const full = candidates[0]!;
    byName.set(plain(full.character), combine(full, short));
    byName.delete(plain(short.character));
    merged.add(short);
  }
  return [...byName.values()];
}

// Observers each upload their own copy of a run, with their own id and slightly different start and end.
// A copy is the SAME run when it is the same dungeon and difficulty, the time windows overlap (or the ends are
// within two minutes of each other: a back-to-back repeat with the same crew starts after the first ends), and at least two players (one, for a solo run) match by first name.
const SAME_RUN_SLACK_SECONDS = 120;
// unfinished (9.3): look for the guildmate's UNFINISHED copy of a run that arrives COMPLETED instead (stored ABANDONED by one
// addon while another saw the final boss under a different run id): that copy is upgraded in place rather than stored twice.
async function sameRunAs(tx: Tx, guildId: string, run: DungeonRunInput, unfinished = false) {
  if (!run.startedAt || !run.endedAt) return null;
  const start = run.startedAt, end = run.endedAt;
  const candidates = await tx.dungeonRun.findMany({
    where: { guildId, instanceId: run.instanceId, difficultyId: run.difficultyId,
      startedAt: { gte: new Date((start - 4 * 3600 - SAME_RUN_SLACK_SECONDS) * 1000), lte: new Date((end + SAME_RUN_SLACK_SECONDS) * 1000) } },
    include: { players: true }
  });
  const names = new Set(run.players.map((player) => firstNameKey(player.character)));
  return candidates.find((candidate) => {
    if (!candidate.startedAt || candidate.difficultyId !== run.difficultyId) return false;
    if (unfinished ? candidate.state === "COMPLETED" : candidate.state !== "COMPLETED" && run.state === "COMPLETED") return false;
    const candidateEnd = candidate.endedAt ?? new Date(candidate.startedAt.getTime() + (candidate.durationSec ?? 0) * 1000);
    if (candidate.startedAt.getTime() / 1000 > end + SAME_RUN_SLACK_SECONDS || candidateEnd.getTime() / 1000 < start - SAME_RUN_SLACK_SECONDS) return false;
    const shared = new Set(candidate.players.map((player) => firstNameKey(player.character)).filter((key) => names.has(key))).size;
    return shared >= Math.min(2, names.size, candidate.players.length);
  }) ?? null;
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
  const summary: DungeonImportSummary = { results: [], duplicates: 0, malformed: 0, receipts: [] };
  // (9.3.1) Backstop: a run marked viaGroup reached the uploader only through a party or raid and belongs to the public boards' relay
  // lane, never to a guild. Every guild import path (signed upload, officer import, addon import) ends here, so none can store one.
  rawRuns = rawRuns.filter((raw) => (raw as { viaGroup?: unknown } | null)?.viaGroup !== true);
  if (rawRuns.length === 0) return summary;
  await importRuns(tx, guildId, rawRuns, characters, appliedBy, importId, now, summary);
  // Same transaction as the import: stored, copied and refused runs are all acknowledged.
  await saveRunReceipts(tx, guildId, summary.receipts ?? [], now);
  const completed = new Set(summary.results.filter((result) => result.valid && result.state === "COMPLETED").map((result) => result.runRef));
  if (completed.size) summary.shareable = rawRuns.filter((raw) => completed.has(refOf(raw) ?? ""));
  console.info(uploadRunsLine(guildId, importId, rawRuns.length, summary));
  return summary;
}

/**
 * (9.3) One journal line per upload that carried dungeon runs, so "Uploaded" can be told apart from "the runs arrived": counts of
 * received, newly stored, already stored, guildmate copies, and refused runs by reason. Ids are shortened like the import timing
 * lines (last characters only); no names and no run references.
 */
export function uploadRunsLine(guildId: string, importId: string | null, received: number, summary: DungeonImportSummary): string {
  const receipts = summary.receipts ?? [];
  const reasons = new Map<string, number>();
  for (const receipt of receipts) {
    if (receipt.outcome !== "refused" && receipt.outcome !== RETRY_OUTCOME) continue;
    const key = `${receipt.outcome}:${(receipt.reason ?? "?").replace(/[\s,=]+/g, "_").slice(0, 40)}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const fresh = receipts.filter((receipt) => receipt.outcome === "stored" && receipt.fresh).length;
  const again = receipts.filter((receipt) => receipt.outcome === "stored" && !receipt.fresh).length;
  const copies = receipts.filter((receipt) => receipt.outcome === "copy").length;
  return `dungeon-runs guild=${guildId.slice(-6)} import=${importId?.slice(-8) ?? "-"} received=${received} stored=${fresh} known=${again} copies=${copies} malformed=${summary.malformed} refused=${[...reasons].map(([reason, count]) => `${reason}x${count}`).join(",") || "-"}`;
}

/**
 * Is this COMPLETED run's final boss only vouched for by a guildmate's copy? Only the EXPLICIT markers count: the run's
 * `peerConfirmed`, or an encounter whose source is `peer`. "No source" is deliberately NOT a marker: every kill an addon records
 * itself carries `native` since 7.5.1 (a locally recovered run needs a native kill), but a run relayed by a guildmate and uploaded
 * by another companion has kills without a source, and treating those as peer-vouched would hold legitimate runs.
 * What this cannot prevent: a modified client that omits the markers or labels a kill it never saw as native, or sends a run under
 * a fresh id. It is a check that two reporters agree for 9.3 addons, not protection against a cheating client.
 */
function peerVouched(run: DungeonRunInput): boolean {
  return run.peerConfirmed === true || !!run.encounters?.some((encounter) => encounter.source === "peer");
}

async function importRuns(tx: Tx, guildId: string, rawRuns: unknown[], characters: LinkedCharacter[], appliedBy: string, importId: string | null, now: Date, summary: DungeonImportSummary): Promise<void> {
  const receipts = (summary.receipts ??= []);
  const cutoff = dungeonResetCutoff();
  const parsed = rawRuns.map((raw) => dungeonRunSchema.safeParse(raw));
  summary.malformed = parsed.filter((result) => !result.success).length;
  parsed.forEach((result, index) => {
    if (result.success) return;
    const issue = result.error.issues[0];
    logDungeonRun(`malformed (${issue ? `${issue.path.join(".")}: ${issue.code}` : "unreadable"})`, rawRuns[index] as Record<string, unknown> | null);
    const ref = refOf(rawRuns[index]);
    if (ref) receipts.push({ runRef: ref, outcome: RETRY_OUTCOME, reason: "Run data could not be read", runId: null });
  });
  const sorted = parsed.filter((result) => result.success).map((result) => result.data)
    .filter(run => {
      if (!predatesDungeonReset(run, cutoff)) return true;
      logDungeonRun("predates the dungeon reset", run);
      receipts.push({ runRef: run.id, outcome: "refused", reason: "Played before the dungeon reset", runId: null });
      summary.duplicates++;
      return false;
    })
    .sort((a, b) => (a.endedAt ?? a.startedAt ?? 0) - (b.endedAt ?? b.startedAt ?? 0));
  if (!sorted.length) return;
  const known = await knownRuns(tx, guildId, sorted);
  for (const receipt of known.values()) { receipts.push(receipt); summary.duplicates++; }
  const runs = sorted.filter((run) => !known.has(run.id));
  if (!runs.length) return;
  // (9.3) The addon's compact note on an unfinished run (instance, last kills, how the final boss is known), so a final boss the
  // addon does not know yet can be found from the journal. Ids and boss names only.
  for (const run of runs.filter((candidate) => candidate.state === "ABANDONED" && candidate.diagnostic).slice(0, 5)) {
    console.info(`dungeon-run-unfinished instance=${run.instanceId} difficulty=${run.difficultyId} note=${(run.diagnostic ?? "").replace(/\s+/g, " ").slice(0, 240)}`);
  }
  // Import, rotation and finalization share this lock, including direct import callers.
  if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
  await lockDungeonCalendar(tx);
  const config = sharedDungeonConfig();
  const currentSeason = await activeSeason(tx, guildId, now);
  const ratingCache = new Map<string, Awaited<ReturnType<typeof dungeonRating>>>();

  // Oldest first, using event-time ownership for the new integrity policy.
  for (let run of runs) {
    // Traced map cells are merged into the shared per-floor grid below and never stored with the run (observer reports keep
    // the uploaded run, so they are taken off it first). Removed in place: the rest of the pipeline keeps the same run object.
    const mapCells = run.mapCells;
    delete run.mapCells;
    const season = await seasonForRun(tx, guildId, currentSeason, run.endedAt);
    const rated = hasDungeonRating(season.ratingRules);
    const timed = rated && (season.ratingRules as { version: number }).version >= 3;
    const november = validBracketedRules(season.ratingRules) ? withIntegrityWindow(season.ratingRules, season.startsAt, season.endsAt)
      : validRouteRules(season.ratingRules) ? season.ratingRules : undefined;
    const brackets = validBracketedRules(season.ratingRules) ? season.ratingRules.brackets : undefined;
    const overlevelAllowance = validBracketedRules(season.ratingRules) ? leniencyOf(season.ratingRules).overLevels : 0;
    const belowAllowance = validBracketedRules(season.ratingRules) ? leniencyOf(season.ratingRules).belowLevels : 0;
    const ruleVersion = (season.ratingRules as { version?: number } | null)?.version;
    if ((ruleVersion === 5 || ruleVersion === 6) && !november) throw new Error("Invalid November rules; import refused without awards");
    const bestEight = rated && ((season.ratingRules as { version: number }).version === 4 || november !== undefined);
    const ratingRules = season.ratingRules as unknown as { targets: Record<string, number>; levelBands: Record<string, LevelBand>; participationLevelBands: Record<string, LevelBand> };
    const participationRules = bestEight ? { targets: {}, levelBands: ratingRules.participationLevelBands } : timed ? season.ratingRules as unknown as { targets: Record<string, number>; levelBands: Record<string, LevelBand> } : config;

    const check = validateRun(run, now);
    // Valid, real runs only (never a simulation): a failed merge must not fail the import.
    if (check.ok && !run.id.startsWith("SIM-")) await mergeRunCells(tx, run.name, mapCells).catch((error: unknown) => console.error("Dungeon map merge failed", error));
    if (gameEditionOf(run) !== "forever") {
      for (const player of run.players) player.character = addonName(player.character, player.realm, gameEditionOf(run));
    }
    let existing = await tx.dungeonRun.findUnique({ where: { guildId_runRef: { guildId, runRef: run.id } } });
    // (9.3) A COMPLETED run under a new id whose unfinished copy is stored under another id upgrades that copy.
    let copyUpgrade = false;
    if (!existing && run.state === "COMPLETED" && check.ok && run.startedAt && run.endedAt) {
      const unfinishedCopy = await sameRunAs(tx, guildId, run, true);
      if (unfinishedCopy && unfinishedCopy.instanceId === run.instanceId) { existing = unfinishedCopy; copyUpgrade = true; }
    }
    // (9.3) A run whose final boss only a guildmate's copy vouched for (the addon recovered it from that copy, `peerConfirmed`)
    // ranks only when the guildmate's OWN copy is also stored COMPLETED by final boss: two reporters agree. Until then it
    // gets a retry receipt (not an acknowledgement) so the addon keeps it. When they agree, ours folds into that stored run
    // as a corroborating copy (the run is never stored or ranked twice).
    let peerAgrees: Awaited<ReturnType<typeof sameRunAs>> = null;
    if (run.state === "COMPLETED" && check.ok && existing?.state !== "COMPLETED" && peerVouched(run)) {
      const candidate = run.startedAt && run.endedAt ? await sameRunAs(tx, guildId, run) : null;
      if (candidate && candidate.state === "COMPLETED" && candidate.valid && candidate.completedBy === "final boss" && candidate.runRef !== run.id && candidate.instanceId === run.instanceId) peerAgrees = candidate;
      else {
        logDungeonRun("peer-recovered run waits for the guildmate's own copy", run);
        receipts.push({ runRef: run.id, outcome: RETRY_OUTCOME, reason: "Waiting for the guildmate's own copy", runId: null, fresh: true });
        continue;
      }
    }
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
              class:p.className,role:p.role,presentSec:p.presentSec,deaths:p.deaths,inGuild:run.players.find(q=>q.character===p.character)?.inGuild??false,guild:run.players.find(q=>q.character===p.character)?.guild??null}))}} : {})
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
    // Several observers can report the same character (with and without a realm): keep one row each.
    run = { ...run, players: dedupeRunPlayers(run.players) };
    // A run first stored as ABANDONED/INVALID can arrive again as COMPLETED under the same id: the
    // addon recovers a final-boss kill it did not recognise (8.4.4 to 8.4.6, Forever dungeons).
    // It replaces the stored copy once; a COMPLETED run is never rewritten this way.
    let upgraded: typeof existing = null;
    if (existing && !reconciled && !peerAgrees && existing.state !== "COMPLETED" && run.state === "COMPLETED" && check.ok
      && existing.instanceId === run.instanceId && run.startedAt && run.endedAt) {
      const recoveredDuration = run.endedAt - run.startedAt;
      upgraded = await tx.dungeonRun.update({ where: { id: existing.id }, data: {
        state: run.state, valid: true, invalidReason: null,
        startedAt: new Date(run.startedAt * 1000), endedAt: new Date(run.endedAt * 1000), durationSec: recoveredDuration,
        completedBy: run.completedBy ?? run.endReason ?? null,
        difficultyId: run.difficultyId,
        competitionData: { ...(run.integrity ? { integrity: run.integrity } : {}),
          players: run.players.map(p => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null, ...(p.integrity ? { integrity: p.integrity } : {}) })),
          encounters: run.encounters ?? [], observerReports: [run], gameBuild: run.gameBuild ?? null, startTrigger: run.startTrigger ?? null,
          challengeMode: run.challengeMode ?? false, upgradedFrom: existing.state } as Prisma.InputJsonValue,
        addonVersion: run.addonVersion ?? existing.addonVersion,
        players: { deleteMany: {}, create: run.players.map(player => ({
          character: player.character, memberId: findCharacter(characters, player.character, player.realm, gameEditionOf(run))?.memberId ?? null,
          class: player.class ?? null, role: dungeonRole(player.role), deaths: player.deaths ?? null, presentSec: player.presentSec, inGuild: player.inGuild, guild: player.guild ?? null })) }
      } });
    }
    if (existing && !reconciled && !upgraded && !peerAgrees) {
      // Routine: the companion sends every saved run on each upload. Not logged any more (it filled
      // the journal); the receipt is what tells the addon to stop waiting for it.
      receipts.push({ runRef: run.id, outcome: "stored", reason: receiptReason(existing.invalidReason ?? (existing.state === "COMPLETED" ? null : "Not completed")), runId: existing.id });
      summary.duplicates++;
      continue;
    }
    const sameRun = peerAgrees ?? (existing ? null : await sameRunAs(tx, guildId, run));
    if (sameRun) {
      logDungeonRun("another observer's copy of a stored run", run);
      // Keep the copy as evidence and add anyone the first report missed. Never a new run, never a new post.
      const known = new Set(sameRun.players.map((player) => firstNameKey(player.character)));
      const extra = run.players.filter((player) => !known.has(firstNameKey(player.character)));
      const data = sameRun.competitionData as { observerReports?: unknown[]; [key: string]: unknown } | null;
      await tx.dungeonRun.update({ where: { id: sameRun.id }, data: {
        competitionData: { ...data, observerReports: [...(data?.observerReports ?? []).slice(-39), run] } as Prisma.InputJsonValue,
        ...(extra.length ? { players: { create: extra.map((player) => ({ character: player.character,
          memberId: findCharacter(characters, player.character, player.realm, gameEditionOf(run))?.memberId ?? null,
          class: player.class ?? null, role: dungeonRole(player.role), deaths: player.deaths ?? null, presentSec: player.presentSec, inGuild: player.inGuild, guild: player.guild ?? null })) } } : {})
      } });
      receipts.push({ runRef: run.id, outcome: "copy", state: run.state, reason: "Counted with a guildmate's copy of this run", runId: sameRun.id });
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

    // Why the run earns nothing, in a few words the member sees in game (the run's receipt).
    const notScored = earnsPoints ? null : !check.ok ? (check.reason ?? "Invalid run")
      : run.state !== "COMPLETED" ? "Not completed"
      : windowReason ? windowReason : durationSec === null ? "No start or end time" : !inSeason ? "Outside the season window"
      : bestEight && evidence.completedBy !== "final boss" ? "Final boss kill not detected"
      : "No earning rule applied";
    if (!earnsPoints) {
      logDungeonRun(!check.ok ? `invalid (${check.reason ?? "unknown"})` : run.state !== "COMPLETED" ? `not completed (${run.state})`
        : windowReason ? windowReason : durationSec === null ? "no start or end time" : !inSeason ? "outside the season window"
        : bestEight && evidence.completedBy !== "final boss" ? "completion was not detected as the final boss"
        : "no earning rule applied", run);
    }

    // Records and history are judged BEFORE this run is saved.
    let guildRecord = false;
    let previousGuildBest: number | null = null;
    let guildRank: DungeonImportResult["guildRank"];
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
      if (recordEligible) guildRank = { rank: 1 + recordHistory.filter(row => row.durationSec! < durationSec).length, of: recordHistory.length + 1 };
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

    const stored = upgraded ?? existing ?? await tx.dungeonRun.create({
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
        competitionData: { ...(run.integrity ? { integrity: run.integrity } : {}), players: run.players.map(p => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null, ...(p.integrity ? { integrity: p.integrity } : {}) })), encounters: run.encounters ?? [], ...(run.deathPoints?.length ? { deathPoints: run.deathPoints } : {}),
          ...(run.diagnostic ? { diagnostic: run.diagnostic } : {}),
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
            inGuild: player.inGuild,
            guild: player.guild ?? null
          }))
        }
      }
    });

    // An upgraded copy under a new id is recorded as a COPY of the upgraded run (knownRuns answers it from this receipt on every
    // later upload): sending it through the whole loop again would append the same report to the run's observer reports each time.
    receipts.push({ runRef: run.id, outcome: copyUpgrade ? "copy" : "stored", state: run.state, reason: receiptReason(notScored), runId: stored.id, fresh: true });
    if (copyUpgrade) logDungeonRun("completed copy upgraded a stored unfinished run", run);
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
    const mapOutline = run.deathPoints?.length ? await outlineFor(tx, deathMapOf(run.deathPoints)).catch(() => null) : null;
    summary.results.push({
      runRef: run.id,
      runId: stored.id,
      ...(mapOutline ? { mapOutline } : {}),
      dungeonName: run.name,
      instanceId: run.instanceId,
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
      ...(run.deathPoints?.length ? { deathPoints: run.deathPoints } : {}),
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
          : competitionReason({ ...evidence, players: evidence.players.map(p => ({ ...p, member: null })) }, ratingRules.levelBands[dungeonKey], overlevelAllowance, belowAllowance)
            ?? (!ratingRules.targets[dungeonKey] ? "Target not calibrated"
              : player.presentSec < (durationSec ?? 0) * 0.8 ? `Presence ${Math.floor(100 * player.presentSec / (durationSec || 1))}% / 80% required` : undefined) : undefined;
        return {
        character: player.character, ...(player.guild ? { guild: player.guild } : {}), ...(player.class ? { class: player.class } : {}), ...(cardRole(player) ? { role: cardRole(player)! } : {}),
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
      ...(guildRank ? { guildRank } : {}),
      personalRecords,
      players: run.players.map((player) => player.character),
      deaths: run.players.some((player) => typeof player.deaths === "number")
        ? run.players.reduce((sum, player) => sum + (player.deaths ?? 0), 0) : null,
      unlinked: linked.filter((entry) => !entry.character).map((entry) => entry.player.character),
      inGuildPlayers: run.players.filter((player) => player.inGuild).map((player) => player.character),
      mentions: Object.fromEntries(linked.flatMap(({ player, character }) => character?.discordId ? [[player.character, character.discordId] as const] : [])),
      fullNames: Object.fromEntries(run.players.flatMap(player => {
        const full = runFullName(player.character, characters, run.players.map(p => p.character));
        return full !== player.character ? [[player.character, full] as const] : [];
      })),
      achievements
    });
  }
}

/**
 * (9.3.2) One run, imported into another guild that has a member in it (cross-guild-runs.ts): the same pipeline as that guild's own
 * uploads, with that guild's own season and rules, points only for that guild's own members, and receipts so the run is never counted twice.
 */
export async function importSharedRun(tx: Tx, guildId: string, run: unknown, characters: LinkedCharacter[], now: Date): Promise<DungeonImportSummary> {
  const summary: DungeonImportSummary = { results: [], duplicates: 0, malformed: 0, receipts: [] };
  await importRuns(tx, guildId, [run], characters, "cross-guild", null, now, summary);
  await saveRunReceipts(tx, guildId, summary.receipts ?? [], now);
  return summary;
}
