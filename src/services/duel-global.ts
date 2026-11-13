import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { DUEL_RULES } from "./duel-rules.js";
import { placement, RATING, rateSeason, ratingStandings, seasonOf, type RatedDuel } from "./duel-rating.js";

// The global duel ladder (rating-v1, from 1 December 2026 UTC): the same rating as the guild ladders, over every counted duel that
// a Guilded addon reported, whichever guild the players are in. One canonical row per duel (PublicDuel); every reporter adds a
// PublicDuelReport. Ratings are never stored: they are recomputed per month from the counted rows, in date order.
//
// Trust (owner decision, 13 November 2026): one witness counts in full. This is NOT cheat-proof: the data comes from players' own
// clients, and anything an unmodified addon can write, a modified one can write. The protections are the ones below: the caps,
// plausibility checks, per-device sequence numbers, exclusions per device, an anomaly list for a human, and a "confirmed by both"
// mark when both players' addons reported the same duel. Nothing here down-weights a result silently.

/** Whether a character that never reported a duel itself can be ranked (its rating would rest on other people's reports only). */
export const GLOBAL_RANK_OUTSIDERS = false;
/** Whether a character outside any listed guild shows with its name (owner decision: yes). One switch to hide them as "a player outside the listed guilds". */
export const SHOW_OUTSIDER_NAMES = true;
/** Plausibility bounds for a reported duel. */
export const GLOBAL_LIMITS = { minDurationSec: 3, maxDurationSec: 30 * 60, maxAgeDays: 30, futureSlackMs: 300_000, maxRows: 200, textMax: 60 } as const;

/** Text from a client: control characters out, whitespace collapsed, cut to `max` (rendered escaped; never a link or markup). */
export const cleanText = (text: string | null | undefined, max: number = GLOBAL_LIMITS.textMax) => (text ?? "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** "Name-Realm" or a bare name plus a realm to the stored pair. */
export function splitName(full: string, realm = ""): { name: string; realm: string } {
  const text = cleanText(full, 80);
  const dash = text.indexOf("-");
  if (dash > 0 && !realm) return { name: text.slice(0, dash).trim(), realm: text.slice(dash + 1).trim() };
  return { name: dash > 0 ? text.slice(0, dash).trim() : text, realm: cleanText(realm, 60) };
}
/** One character on the global ladder: lower-case name and realm without spaces or punctuation. Never printed. */
export const characterKey = (name: string, realm: string) => `${name.trim().toLowerCase()}-${realm.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")}`;

/** The record an addon sends for a duel, including one outside every guild it knows (the spec is docs/DUEL_RATING_ADDON_SPEC.md). */
export const externalDuelSchema = z.object({
  winner: z.string().trim().min(1).max(80),
  loser: z.string().trim().min(1).max(80),
  winnerRealm: z.string().trim().max(60).default(""),
  loserRealm: z.string().trim().max(60).default(""),
  winnerClass: z.string().trim().max(30).optional(),
  loserClass: z.string().trim().max(30).optional(),
  winnerLevel: z.number().int().min(1).max(60).optional(),
  loserLevel: z.number().int().min(1).max(60).optional(),
  winnerGuild: z.string().max(80).optional(),
  loserGuild: z.string().max(80).optional(),
  zone: z.string().max(80).optional(),
  at: z.number().int().positive().max(4102444800),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  reason: z.enum(["knockout", "retreat"]),
  /** Which side the reporting character was: only a participant can report a duel. */
  side: z.enum(["winner", "loser"]),
  /** The addon's running number for this install, and the keyed checksum over the fields (see duelSig). */
  seq: z.number().int().min(1).max(2_000_000_000).optional(),
  sig: z.string().regex(/^[0-9a-f]{16}$/).optional()
}).strict();
export type ExternalDuelInput = z.infer<typeof externalDuelSchema>;

/**
 * The checksum the addon puts on a record: the first 16 hex of SHA-256 over the install secret, the sequence number and the fields.
 * The server never learns the secret, so it cannot check this; the addon and the companion use it to notice a saved-variables file
 * that was edited by hand, and the server checks only its shape and the sequence. It stops casual edits, not a modified addon.
 */
export const duelSig = (secret: string, d: Pick<ExternalDuelInput, "winner" | "loser" | "winnerRealm" | "loserRealm" | "at" | "reason" | "seq">) =>
  createHash("sha256").update([secret, d.seq ?? 0, d.winner, d.winnerRealm ?? "", d.loser, d.loserRealm ?? "", d.at, d.reason].join("|")).digest("hex").slice(0, 16);

/** Why a record cannot be a real duel (null = plausible). */
export function implausible(d: ExternalDuelInput, now: Date): string | null {
  const w = splitName(d.winner, d.winnerRealm), l = splitName(d.loser, d.loserRealm);
  if (characterKey(w.name, w.realm) === characterKey(l.name, l.realm)) return "same-character";
  const age = now.getTime() - d.at * 1000;
  if (age < -GLOBAL_LIMITS.futureSlackMs) return "future";
  if (age > GLOBAL_LIMITS.maxAgeDays * 86_400_000) return "old";
  if (d.durationSec !== undefined && d.durationSec > 0 && (d.durationSec < GLOBAL_LIMITS.minDurationSec || d.durationSec > GLOBAL_LIMITS.maxDurationSec)) return "duration";
  return null;
}

type Tx = Prisma.TransactionClient;
export interface DuelSource {
  /** "member:<id>" for a guild member, "install:<id>" for a standalone addon. */
  reporterKey: string;
  deviceId?: string | null;
  guildId?: string | null;
  /** The reporter's guild name and realm when the records come from a guild server (fills a side's guild text when the client sent none). */
  guildName?: string | null;
  guildRealm?: string | null;
  /** Mirrored guild duels know the members behind each side. */
  winnerMemberId?: string | null; loserMemberId?: string | null;
}
export interface GlobalImportResult { recorded: number; counted: number; capped: number; confirmed: number; rejected: number; replays: number; excluded: boolean }

const dayOf = (at: Date) => at.toISOString().slice(0, 10);
const pairOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Stores the duels a client reported. Runs inside the import transaction; one statement failing aborts it, so every row is validated first. */
export async function recordGlobalDuels(tx: Pick<Tx, "publicDuel" | "publicDuelReport" | "publicDuelExclusion">, source: DuelSource, rows: unknown[], now = new Date(), edition = "forever"): Promise<GlobalImportResult> {
  const result: GlobalImportResult = { recorded: 0, counted: 0, capped: 0, confirmed: 0, rejected: 0, replays: 0, excluded: false };
  if (!rows.length) return result;
  if (source.deviceId && await tx.publicDuelExclusion.findUnique({ where: { deviceId: source.deviceId }, select: { deviceId: true } })) return { ...result, rejected: rows.length, excluded: true };
  const parsed = rows.slice(0, GLOBAL_LIMITS.maxRows).flatMap(row => { const p = externalDuelSchema.safeParse(row); return p.success ? [p.data] : []; });
  result.rejected += rows.length - parsed.length;
  parsed.sort((a, b) => a.at - b.at);
  for (const d of parsed) {
    if (implausible(d, now)) { result.rejected++; continue; }
    const w = splitName(d.winner, d.winnerRealm), l = splitName(d.loser, d.loserRealm);
    const winnerKey = characterKey(w.name, w.realm), loserKey = characterKey(l.name, l.realm);
    const endedAt = new Date(d.at * 1000);
    // A sequence number that was already used by a different record of the same device is a replay.
    if (source.deviceId && d.seq) {
      const used = await tx.publicDuelReport.findFirst({ where: { deviceId: source.deviceId, seq: d.seq }, select: { duel: { select: { winnerKey: true, loserKey: true, endedAt: true } } } });
      if (used && (used.duel.winnerKey !== winnerKey || used.duel.loserKey !== loserKey || used.duel.endedAt.getTime() !== endedAt.getTime())) { result.replays++; result.rejected++; continue; }
    }
    const reporterCharacterKey = d.side === "winner" ? winnerKey : loserKey;
    const day = dayOf(endedAt);
    const near = await tx.publicDuel.findFirst({ where: { gameEdition: edition, winnerKey, loserKey,
      endedAt: { gte: new Date(endedAt.getTime() - DUEL_RULES.dedupeSeconds * 1000), lte: new Date(endedAt.getTime() + DUEL_RULES.dedupeSeconds * 1000) } },
      select: { id: true, winnerClass: true, loserClass: true, winnerLevel: true, loserLevel: true, winnerGuild: true, loserGuild: true, reports: { select: { reporterCharacterKey: true } } } });
    const guildText = (own: string | undefined, mine: boolean) => cleanText(own) || (mine ? cleanText(source.guildName) : "") || null;
    const winnerGuild = guildText(d.winnerGuild, d.side === "winner"), loserGuild = guildText(d.loserGuild, d.side === "loser");
    if (near) {
      const made = await tx.publicDuelReport.createMany({ skipDuplicates: true, data: [{ duelId: near.id, reporterKey: source.reporterKey, reporterCharacterKey, deviceId: source.deviceId ?? null, guildId: source.guildId ?? null, dayKey: day, seq: d.seq ?? null }] });
      if (made.count) {
        // The other side's report: "confirmed by both". Fill only what the first report left empty.
        const keys = new Set([...near.reports.map(r => r.reporterCharacterKey), reporterCharacterKey]);
        await tx.publicDuel.update({ where: { id: near.id }, data: {
          confirmations: { increment: 1 },
          ...(!near.winnerClass && d.winnerClass ? { winnerClass: cleanText(d.winnerClass, 30) } : {}), ...(!near.loserClass && d.loserClass ? { loserClass: cleanText(d.loserClass, 30) } : {}),
          ...(near.winnerLevel == null && d.winnerLevel ? { winnerLevel: d.winnerLevel } : {}), ...(near.loserLevel == null && d.loserLevel ? { loserLevel: d.loserLevel } : {}),
          ...(!near.winnerGuild && winnerGuild ? { winnerGuild } : {}), ...(!near.loserGuild && loserGuild ? { loserGuild } : {}) } });
        if (keys.has(winnerKey) && keys.has(loserKey)) result.confirmed++;
      }
      continue;
    }
    const pair = pairOf(winnerKey, loserKey);
    const [pairCount, reporterCount] = await Promise.all([
      tx.publicDuel.count({ where: { gameEdition: edition, pairKey: pair, dayKey: day, counted: true } }),
      tx.publicDuelReport.count({ where: { reporterKey: source.reporterKey, dayKey: day, duel: { counted: true, gameEdition: edition } } })
    ]);
    const counted = pairCount < DUEL_RULES.pairDailyCap && reporterCount < DUEL_RULES.reporterDailyCap;
    await tx.publicDuel.create({ data: {
      gameEdition: edition, winnerKey, loserKey, winnerName: w.name, winnerRealm: w.realm, loserName: l.name, loserRealm: l.realm,
      winnerClass: cleanText(d.winnerClass, 30) || null, loserClass: cleanText(d.loserClass, 30) || null, winnerLevel: d.winnerLevel ?? null, loserLevel: d.loserLevel ?? null,
      winnerGuild, loserGuild, winnerMemberId: source.winnerMemberId ?? null, loserMemberId: source.loserMemberId ?? null,
      zone: cleanText(d.zone) || null, endedAt, durationSec: d.durationSec || null, reason: d.reason, counted, pairKey: pair, dayKey: day,
      reports: { create: [{ reporterKey: source.reporterKey, reporterCharacterKey, deviceId: source.deviceId ?? null, guildId: source.guildId ?? null, dayKey: day, seq: d.seq ?? null }] }
    } });
    result.recorded++;
    if (counted) result.counted++; else result.capped++;
  }
  return result;
}

/** A guild duel just stored by the guild import (see FreshDuel in duels.ts), mirrored into the global tables. */
export interface MirroredDuel { winnerId: string; loserId: string; winnerCharacter: string; loserCharacter: string; winnerLevel: number | null; loserLevel: number | null; reason: string; endedAt: Date }
/**
 * The guild import mirrors each newly COUNTED guild duel here (reporter = the paired member who uploaded it). Hidden and test members are
 * skipped, so a duel of theirs never reaches the public ladder. `classes` maps a member id + lower-case name to the stored class.
 */
export async function mirrorGuildDuels(tx: Pick<Tx, "publicDuel" | "publicDuelReport" | "publicDuelExclusion">, info: { guildId: string; guildName: string | null; realm: string; reporterMemberId: string; hidden: ReadonlySet<string>; classOf: (memberId: string, name: string) => string | null },
  duels: readonly MirroredDuel[], now = new Date()): Promise<GlobalImportResult> {
  const total: GlobalImportResult = { recorded: 0, counted: 0, capped: 0, confirmed: 0, rejected: 0, replays: 0, excluded: false };
  for (const duel of duels) {
    if (info.hidden.has(duel.winnerId) || info.hidden.has(duel.loserId)) { total.rejected++; continue; }
    const side = duel.winnerId === info.reporterMemberId ? "winner" : duel.loserId === info.reporterMemberId ? "loser" : null;
    if (!side) { total.rejected++; continue; }
    const r = await recordGlobalDuels(tx, { reporterKey: `member:${info.reporterMemberId}`, guildId: info.guildId, guildName: info.guildName, guildRealm: info.realm, winnerMemberId: duel.winnerId, loserMemberId: duel.loserId }, [{
      winner: duel.winnerCharacter, loser: duel.loserCharacter, winnerRealm: info.realm, loserRealm: info.realm,
      ...(info.classOf(duel.winnerId, duel.winnerCharacter) ? { winnerClass: info.classOf(duel.winnerId, duel.winnerCharacter)! } : {}), ...(info.classOf(duel.loserId, duel.loserCharacter) ? { loserClass: info.classOf(duel.loserId, duel.loserCharacter)! } : {}),
      ...(duel.winnerLevel ? { winnerLevel: duel.winnerLevel } : {}), ...(duel.loserLevel ? { loserLevel: duel.loserLevel } : {}),
      ...(info.guildName ? { winnerGuild: info.guildName, loserGuild: info.guildName } : {}),
      at: Math.floor(duel.endedAt.getTime() / 1000), reason: duel.reason === "retreat" ? "retreat" : "knockout", side }], now);
    for (const key of ["recorded", "counted", "capped", "confirmed", "rejected", "replays"] as const) total[key] += r[key];
  }
  return total;
}

/** A counted duel as the global ladder uses it. `reporters` are the characters (keys) that reported it themselves. */
export interface GlobalDuel {
  winnerKey: string; loserKey: string;
  winner: string; loser: string; winnerRealm: string; loserRealm: string;
  winnerClass: string | null; loserClass: string | null;
  winnerLevel: number | null; loserLevel: number | null;
  winnerGuild: string | null; loserGuild: string | null;
  endedAt: Date; reason: string; zone: string | null; durationSec: number | null;
  reporters: string[];
  /** Both players' addons reported it. */
  confirmed: boolean;
}

export interface GlobalRow {
  key: string; name: string; realm: string; className: string | null; level: number | null; guild: string | null;
  score: number; raw: number; rated: number; opponents: number; ranked: boolean; rank: number;
  wins: number; losses: number; games: number; winRate: number; streak: number; bestStreak: number; lastAt: Date;
  placement: ReturnType<typeof placement> | null;
}
export interface GlobalRecent extends GlobalDuel { change: { winner: number; loser: number; rated: boolean } }
export interface GlobalBoard { rows: GlobalRow[]; duels: number; recent: GlobalRecent[]; season: { id: string } }

export interface GlobalFilters { className: string | null; levels: [number, number] | null }
const inBand = (level: number | null, band: [number, number]) => level !== null && level >= band[0] && level <= band[1];

/** One month of the global ladder. Players that never reported a duel themselves are listed in duels but not ranked (GLOBAL_RANK_OUTSIDERS). */
export function buildGlobalBoard(all: readonly GlobalDuel[], seasonId: string, startsAt: Date, filters: GlobalFilters, recentLimit = 20): GlobalBoard {
  const wanted = filters.className?.toLowerCase() ?? null;
  const inSeason = all.filter(d => seasonOf(d.endedAt, startsAt).id === seasonId && (!filters.levels || (inBand(d.winnerLevel, filters.levels) && inBand(d.loserLevel, filters.levels))));
  const source = new Map<RatedDuel, GlobalDuel>();
  const reporters = new Set<string>(), info = new Map<string, { realm: string; className: string | null; guild: string | null }>();
  const rated: RatedDuel[] = inSeason.map(d => {
    const row: RatedDuel = { winnerKey: d.winnerKey, loserKey: d.loserKey, winnerName: d.winner, loserName: d.loser, winnerLevel: d.winnerLevel, loserLevel: d.loserLevel, endedAt: d.endedAt };
    source.set(row, d);
    for (const key of d.reporters) reporters.add(key);
    return row;
  });
  const result = rateSeason(rated);
  // The latest known class, realm and guild text of each player (duels are in date order).
  for (const row of result.ordered) {
    const d = source.get(row)!;
    for (const side of ["winner", "loser"] as const) {
      const key = d[`${side}Key`], before = info.get(key);
      info.set(key, { realm: d[`${side}Realm`], className: d[`${side}Class`] ?? before?.className ?? null, guild: d[`${side}Guild`] ?? before?.guild ?? null });
    }
  }
  const eligible = (key: string) => GLOBAL_RANK_OUTSIDERS || reporters.has(key);
  const standings = ratingStandings(result.players).filter(row => eligible(row.key) && (!wanted || info.get(row.key)?.className?.toLowerCase() === wanted));
  let next = 0;
  const rows = standings.map((row): GlobalRow => {
    const i = info.get(row.key);
    return { key: row.key, name: row.name, realm: i?.realm ?? "", className: i?.className ?? null, level: row.level, guild: i?.guild ?? null, score: row.score, raw: row.rating, rated: row.rated, opponents: row.opponents,
      ranked: row.ranked, rank: row.ranked ? ++next : 0, wins: row.wins, losses: row.losses, games: row.games, winRate: row.games ? row.wins / row.games : 0, streak: row.streak, bestStreak: row.bestStreak, lastAt: row.lastAt,
      placement: row.ranked ? null : placement(row.rated, row.opponents) };
  });
  const recent: GlobalRecent[] = [];
  for (let i = result.ordered.length - 1; i >= 0 && recent.length < recentLimit; i--) {
    const d = source.get(result.ordered[i]!)!, change = result.changes[i]!;
    if (wanted && d.winnerClass?.toLowerCase() !== wanted && d.loserClass?.toLowerCase() !== wanted) continue;
    recent.push({ ...d, change: { winner: change.winnerDelta, loser: change.loserDelta, rated: change.rated } });
  }
  return { rows, duels: inSeason.length, recent, season: { id: seasonId } };
}

/** Record between two characters (matched by name, case-insensitive) over the given duels. */
export function globalHeadToHead(all: readonly GlobalDuel[], a: string, b: string, last = 10) {
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  if (same(a, b)) return null;
  const knows = (name: string) => all.some(d => same(d.winner, name) || same(d.loser, name));
  if (!knows(a) || !knows(b)) return null;
  const meetings = all.filter(d => (same(d.winner, a) && same(d.loser, b)) || (same(d.winner, b) && same(d.loser, a))).sort((x, y) => y.endedAt.getTime() - x.endedAt.getTime());
  return { a, b, aWins: meetings.filter(d => same(d.winner, a)).length, bWins: meetings.filter(d => same(d.winner, b)).length, last: meetings.slice(0, last) };
}

export interface Anomaly { kind: "one-sided-pair" | "rapid-repeat" | "few-opponents" | "long-streak"; keys: string[]; names: string[]; count: number; detail: string }
export const ANOMALY_LIMITS = { pairMin: 10, pairShare: 0.9, rapidSeconds: 20, rapidMin: 3, fewOpponentsMin: 10, fewOpponentsMax: 2, streak: 15 } as const;

/** Patterns that suggest a result swap or a script, for a human to look at (owner and officers). Nothing is hidden or down-weighted because of them. */
export function duelAnomalies(all: readonly GlobalDuel[]): Anomaly[] {
  const out: Anomaly[] = [];
  const sorted = [...all].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
  const pairs = new Map<string, { a: string; b: string; an: string; bn: string; aw: number; bw: number; times: number[] }>();
  for (const d of sorted) {
    const key = pairOf(d.winnerKey, d.loserKey), first = d.winnerKey < d.loserKey;
    let p = pairs.get(key);
    if (!p) { p = first ? { a: d.winnerKey, b: d.loserKey, an: d.winner, bn: d.loser, aw: 0, bw: 0, times: [] } : { a: d.loserKey, b: d.winnerKey, an: d.loser, bn: d.winner, aw: 0, bw: 0, times: [] }; pairs.set(key, p); }
    if (d.winnerKey === p.a) p.aw++; else p.bw++;
    p.times.push(d.endedAt.getTime());
  }
  for (const p of pairs.values()) {
    const total = p.aw + p.bw;
    if (total >= ANOMALY_LIMITS.pairMin && Math.max(p.aw, p.bw) / total >= ANOMALY_LIMITS.pairShare)
      out.push({ kind: "one-sided-pair", keys: [p.a, p.b], names: [p.an, p.bn], count: total, detail: `${Math.max(p.aw, p.bw)} of ${total} duels won by ${p.aw > p.bw ? p.an : p.bn}` });
    let rapid = 0;
    for (let i = 1; i < p.times.length; i++) if (p.times[i]! - p.times[i - 1]! <= ANOMALY_LIMITS.rapidSeconds * 1000) rapid++;
    if (rapid >= ANOMALY_LIMITS.rapidMin) out.push({ kind: "rapid-repeat", keys: [p.a, p.b], names: [p.an, p.bn], count: rapid, detail: `${rapid} duels within ${ANOMALY_LIMITS.rapidSeconds} s of the previous one` });
  }
  const byReporter = new Map<string, { name: string; opponents: Set<string>; n: number }>();
  const run = new Map<string, { name: string; cur: number; best: number }>();
  for (const d of sorted) {
    for (const key of d.reporters) {
      const mine = key === d.winnerKey ? d.loserKey : d.winnerKey, name = key === d.winnerKey ? d.winner : d.loser;
      const r = byReporter.get(key) ?? { name, opponents: new Set<string>(), n: 0 };
      r.opponents.add(mine); r.n++; byReporter.set(key, r);
    }
    const w = run.get(d.winnerKey) ?? { name: d.winner, cur: 0, best: 0 }, l = run.get(d.loserKey) ?? { name: d.loser, cur: 0, best: 0 };
    w.cur++; w.best = Math.max(w.best, w.cur); l.cur = 0; run.set(d.winnerKey, w); run.set(d.loserKey, l);
  }
  for (const [key, r] of byReporter) if (r.n >= ANOMALY_LIMITS.fewOpponentsMin && r.opponents.size <= ANOMALY_LIMITS.fewOpponentsMax)
    out.push({ kind: "few-opponents", keys: [key], names: [r.name], count: r.n, detail: `${r.n} reported duels against only ${r.opponents.size} different opponent${r.opponents.size === 1 ? "" : "s"}` });
  for (const [key, r] of run) if (r.best >= ANOMALY_LIMITS.streak) out.push({ kind: "long-streak", keys: [key], names: [r.name], count: r.best, detail: `${r.best} wins in a row` });
  return out;
}

/** Gaps and repeats in one device's sequence numbers (a missing number may be a duel the addon never uploaded: information, not proof). */
export function sequenceProblems(seqs: readonly number[]): { gaps: number; repeats: number } {
  const sorted = [...seqs].sort((a, b) => a - b);
  let gaps = 0, repeats = 0;
  for (let i = 1; i < sorted.length; i++) { const step = sorted[i]! - sorted[i - 1]!; if (step === 0) repeats++; else if (step > 1) gaps += step - 1; }
  return { gaps, repeats };
}

export const GLOBAL_RULE_ID = RATING.id;
