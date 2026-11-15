import type { PrismaClient } from "../generated/prisma/client.js";

// Sync health (officer view + once-a-day developer alert). Everything here is read from data the bot already keeps, plus what a companion
// says about itself (SyncHealthReport, header x-companion-health). Nothing is sent to members. The result for a server is cached for an
// hour, so the officer command and the daily alert together cost one set of queries per server per hour.

type Db = Pick<PrismaClient, "companionCredential" | "companionDevice" | "dungeonRunPlayer" | "duelResult" | "carriedRecord" | "dungeonRun" | "dungeonRunReceipt" | "dungeonRunWitness" | "syncHealthReport">;

export type SyncSignal = "silent" | "carried-only" | "refused" | "retrying" | "parked";
export interface SyncIssue { signal: SyncSignal; /** A member's name, a PC code, or null for a server-wide line. */ who: string | null; detail: string; fix: { en: string; fr: string } }

export const SYNC_HEALTH = {
  /** A companion that has not synced for this long while its member keeps playing counts as stopped. */
  silentHours: 24,
  /** How far back to look for play seen by other players' data. */
  playWindowHours: 48,
  /** A carried run whose own recorder has not uploaded it after this long. */
  carriedWaitHours: 12,
  /** A refused or retried ref brought again at least this long after the first time. */
  repeatHours: 6,
  /** A report older than this is no longer shown (the companion sends a new one with every upload). */
  reportFreshHours: 48,
  cacheMs: 3_600_000,
  maxIssues: 25
} as const;

export const SUMMARY_PREFIX = "🩺 **Sync health";
const HOUR = 3_600_000;
const lower = (value: string) => value.toLowerCase();
const firstName = (value: string) => lower(value.split("-")[0] ?? value);
const ago = (now: Date, then: Date) => { const hours = Math.max(1, Math.round((now.getTime() - then.getTime()) / HOUR)); return hours >= 48 ? `${Math.round(hours / 24)} d` : `${hours} h`; };

const FIX_OPEN = { en: "Ask them to open the companion (and /reload in game if it is already open).", fr: "Demandez-leur d'ouvrir le companion (et /reload en jeu s'il est déjà ouvert)." };
const FIX_UPDATE = { en: "Ask them to update the addon and the companion, then /reload.", fr: "Demandez-leur de mettre à jour l'addon et le companion, puis /reload." };
const FIX_DEV = { en: "Developer attention: see the bot's receipts for this reason.", fr: "À voir par le développeur : reçus du bot pour cette raison." };

/** The raw findings for one server. Five signals, one bounded query each (the carried-run signal needs two). */
export async function collectSyncIssues(db: Db, guildId: string, now = new Date()): Promise<SyncIssue[]> {
  const issues: SyncIssue[] = [];
  const since = (hours: number) => new Date(now.getTime() - hours * HOUR);

  // 1. A companion that stopped syncing while its member keeps playing (seen through other players' runs and duels).
  const [credentials, devices, playedRuns, playedDuels] = await Promise.all([
    db.companionCredential.findMany({ where: { revokedAt: null, member: { guildId, status: "ACTIVE", isTest: false } }, select: { memberId: true, createdAt: true, lastUsedAt: true, member: { select: { displayName: true } } }, take: 2_000 }),
    db.companionDevice.findMany({ where: { guildId, claimedMemberId: { not: null }, revokedAt: null }, select: { claimedMemberId: true, lastSeenAt: true }, take: 2_000 }),
    db.dungeonRunPlayer.findMany({ where: { memberId: { not: null }, run: { guildId, endedAt: { gte: since(SYNC_HEALTH.playWindowHours) } } }, select: { memberId: true, run: { select: { endedAt: true } } }, take: 5_000 }),
    db.duelResult.findMany({ where: { guildId, endedAt: { gte: since(SYNC_HEALTH.playWindowHours) } }, select: { winnerId: true, loserId: true, endedAt: true }, take: 5_000 })
  ]);
  const lastPlay = new Map<string, Date>();
  const play = (memberId: string | null, at: Date | null) => { if (memberId && at && (lastPlay.get(memberId)?.getTime() ?? 0) < at.getTime()) lastPlay.set(memberId, at); };
  for (const row of playedRuns) play(row.memberId, row.run.endedAt);
  for (const row of playedDuels) { play(row.winnerId, row.endedAt); play(row.loserId, row.endedAt); }
  const lastSync = new Map<string, { at: Date; name: string }>();
  for (const row of credentials) {
    const at = row.lastUsedAt ?? row.createdAt;
    const known = lastSync.get(row.memberId);
    if (!known || known.at < at) lastSync.set(row.memberId, { at, name: row.member.displayName });
  }
  for (const row of devices) {
    const known = row.claimedMemberId ? lastSync.get(row.claimedMemberId) : null;
    if (known && known.at < row.lastSeenAt) known.at = row.lastSeenAt;
  }
  for (const [memberId, sync] of lastSync) {
    const played = lastPlay.get(memberId);
    if (!played || now.getTime() - sync.at.getTime() < SYNC_HEALTH.silentHours * HOUR || played.getTime() <= sync.at.getTime()) continue;
    issues.push({ signal: "silent", who: sync.name, detail: `companion silent for ${ago(now, sync.at)}, but played ${ago(now, played)} ago (seen in others' runs or duels)`, fix: FIX_OPEN });
  }

  // 2. A guildmate's carried run whose own recorder's upload never arrived.
  // Looked up from this server's own recent runs, so another server's busy carriers cannot crowd these out (CarriedRecord has no guild column; its [kind, runKey] index serves the lookup).
  const recentRuns = await db.dungeonRun.findMany({ where: { guildId, createdAt: { gte: since(72), lte: since(SYNC_HEALTH.carriedWaitHours) } }, select: { runRef: true, instanceId: true, reporterNames: true, players: { select: { character: true, memberId: true, member: { select: { displayName: true } } } } }, take: 500 });
  const runByKey = new Map(recentRuns.map((run) => [`${run.instanceId}:${run.runRef}`, run]));
  const carried = runByKey.size ? await db.carriedRecord.findMany({ where: { kind: "run", status: "applied", runKey: { in: [...runByKey.keys()] } }, select: { authorKey: true, runKey: true }, take: 1_000 }) : [];
  const waiting = new Map<string, Set<string>>();
  for (const row of carried) {
    const run = row.runKey ? runByKey.get(row.runKey) : undefined;
    if (!run) continue;
    const author = firstName(row.authorKey.split("|")[0] ?? row.authorKey);
    if (run.reporterNames.some((name) => firstName(name) === author)) continue;
    const who = run.players.find((candidate) => firstName(candidate.character) === author && candidate.memberId)?.member?.displayName;
    if (who) (waiting.get(who) ?? waiting.set(who, new Set()).get(who)!).add(run.runRef);
  }
  for (const [who, runs] of waiting) issues.push({ signal: "carried-only", who, detail: `${runs.size} run${runs.size === 1 ? "" : "s"} known only from a guildmate's copy for over ${SYNC_HEALTH.carriedWaitHours} h (their own addon's record never arrived)`, fix: FIX_OPEN });

  // 3. Receipts refused (or kept as "retry") and brought again hours later: the same cause every time.
  const receipts = await db.dungeonRunReceipt.findMany({ where: { guildId, outcome: { in: ["refused", "retry"] }, seenAt: { gte: since(SYNC_HEALTH.playWindowHours) } }, select: { reason: true, createdAt: true, seenAt: true }, take: 500 });
  const byReason = new Map<string, number>();
  for (const row of receipts) if (row.seenAt.getTime() - row.createdAt.getTime() >= SYNC_HEALTH.repeatHours * HOUR) byReason.set(row.reason ?? "no reason given", (byReason.get(row.reason ?? "no reason given") ?? 0) + 1);
  for (const [reason, count] of byReason) if (count >= 2) issues.push({ signal: "refused", who: null, detail: `${count} runs refused again and again: ${reason}`, fix: /version|update|old/i.test(reason) ? FIX_UPDATE : FIX_DEV });

  // 4. A PC that keeps sending the same run statements without them being decided.
  const stuck = await db.dungeonRunWitness.findMany({ where: { guildId, status: { in: ["pending", "held"] }, lastSeenAt: { gte: since(SYNC_HEALTH.silentHours) } }, select: { deviceId: true, firstSeenAt: true, lastSeenAt: true, device: { select: { claimedMember: { select: { displayName: true } } } } }, take: 500 });
  const retrying = new Map<string, { count: number; who: string }>();
  for (const row of stuck) {
    if (row.lastSeenAt.getTime() - row.firstSeenAt.getTime() < SYNC_HEALTH.repeatHours * HOUR) continue;
    const known = retrying.get(row.deviceId) ?? { count: 0, who: row.device.claimedMember?.displayName ?? `PC ${row.deviceId.slice(-8)}` };
    known.count++;
    retrying.set(row.deviceId, known);
  }
  for (const { count, who } of retrying.values()) issues.push({ signal: "retrying", who, detail: `keeps sending ${count} run${count === 1 ? "" : "s"} that stay undecided`, fix: FIX_UPDATE });

  // 5. What a companion reported about itself: records it parked, a damaged parked-uploads record.
  const reports = await db.syncHealthReport.findMany({ where: { guildId, reportedAt: { gte: since(SYNC_HEALTH.reportFreshHours) }, OR: [{ parked: { gt: 0 } }, { damaged: true }] }, select: { ownerKey: true, memberId: true, parked: true, damaged: true }, take: 200 });
  if (reports.length) {
    for (const row of reports) {
      const parts = [row.parked > 0 ? `${row.parked} record${row.parked === 1 ? "" : "s"} parked (not sent yet)` : "", row.damaged ? "its parked-uploads file was damaged" : ""].filter(Boolean);
      issues.push({ signal: "parked", who: row.memberId ? (lastSync.get(row.memberId)?.name ?? "a member") : `PC ${row.ownerKey.slice(-8)}`, detail: parts.join(", "), fix: row.damaged ? { en: "Ask them to open the companion and press Repair.", fr: "Demandez-leur d'ouvrir le companion et d'utiliser Réparer." } : FIX_OPEN });
    }
  }
  return issues.slice(0, SYNC_HEALTH.maxIssues);
}

const cache = new Map<string, { at: number; issues: SyncIssue[] }>();
export function resetSyncHealthCache(): void { cache.clear(); }

/** The findings for one server, at most one set of queries per hour. */
export async function syncHealth(db: Db, guildId: string, now = new Date()): Promise<SyncIssue[]> {
  const hit = cache.get(guildId);
  if (hit && now.getTime() - hit.at < SYNC_HEALTH.cacheMs) return hit.issues;
  const issues = await collectSyncIssues(db, guildId, now);
  cache.set(guildId, { at: now.getTime(), issues });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return issues;
}

/** The officer view: one line per finding, reason and fix, no member is told anything. */
export function describeSyncIssues(issues: readonly SyncIssue[], lang: "en" | "fr"): string {
  if (!issues.length) return lang === "fr" ? "Aucun problème de synchronisation détecté pour l'instant (vérifié toutes les heures)." : "No sync problem seen right now (checked once an hour).";
  const head = lang === "fr" ? "**Synchronisation à vérifier**" : "**Sync that looks stuck**";
  const lines = issues.map((issue) => `• ${issue.who ? `**${issue.who}**: ` : ""}${issue.detail}\n  → ${issue.fix[lang]}`);
  return [head, ...lines].join("\n").slice(0, 1_900);
}

/** The developer's once-a-day summary (English, counts first). Names are display names, never sent outside the error-log channel. */
export function developerSummary(guilds: readonly { name: string; issues: readonly SyncIssue[] }[]): string | null {
  const flagged = guilds.filter((guild) => guild.issues.length);
  if (!flagged.length) return null;
  const lines = flagged.map((guild) => {
    const bySignal = new Map<SyncSignal, number>();
    for (const issue of guild.issues) bySignal.set(issue.signal, (bySignal.get(issue.signal) ?? 0) + 1);
    return `• **${guild.name}**: ${[...bySignal].map(([signal, count]) => `${count} ${signal}`).join(", ")} — ${guild.issues.slice(0, 3).map((issue) => `${issue.who ?? "server"}: ${issue.detail}`).join("; ")}`;
  });
  return `${SUMMARY_PREFIX}, daily summary**\n${lines.join("\n")}\nDetails for officers: \`/officer dungeon sync\`.`.slice(0, 1_900);
}

/** Parses the x-companion-health header ("parked=2;damaged=1"). null when it says nothing usable. */
export function parseHealthHeader(value: unknown): { parked: number; damaged: boolean } | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const parked = /(?:^|;)parked=(\d{1,5})(?:;|$)/.exec(value)?.[1];
  const damaged = /(?:^|;)damaged=1(?:;|$)/.test(value);
  if (parked === undefined && !damaged) return null;
  return { parked: parked ? Number(parked) : 0, damaged };
}

/** Stores what a companion said about itself. Never throws; one small write per upload at most (skipped when nothing changed in the last hour). */
export async function recordHealthReport(db: Pick<PrismaClient, "syncHealthReport">, input: { guildId: string; ownerKey: string; memberId: string | null; header: unknown; now?: Date }): Promise<void> {
  const report = parseHealthHeader(input.header);
  if (!report) return;
  const now = input.now ?? new Date();
  try {
    const known = await db.syncHealthReport.findUnique({ where: { guildId_ownerKey: { guildId: input.guildId, ownerKey: input.ownerKey } }, select: { parked: true, damaged: true, reportedAt: true } });
    if (known && known.parked === report.parked && known.damaged === report.damaged && now.getTime() - known.reportedAt.getTime() < HOUR) return;
    await db.syncHealthReport.upsert({ where: { guildId_ownerKey: { guildId: input.guildId, ownerKey: input.ownerKey } }, create: { guildId: input.guildId, ownerKey: input.ownerKey, memberId: input.memberId, parked: report.parked, damaged: report.damaged, reportedAt: now }, update: { memberId: input.memberId, parked: report.parked, damaged: report.damaged, reportedAt: now } });
  } catch { /* health notes must never break an upload */ }
}
