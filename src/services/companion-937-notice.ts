import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { hostedPilot } from "../hosted-pilot.js";
import { siteUrl } from "../site-url.js";
import { versionBelow } from "../compat.js";
import { KNOWN_BROKEN_VERSIONS, collectSyncIssues, type SyncIssue } from "./sync-health.js";

// One direct message (owner decision, 17 November 2026: "One DM each"). The website companion 9.3.7 left run-log.cjs out of its package, so
// it cannot start and cannot update itself. A member is told ONCE when the sync-health stalled-companion rule (sync-health.ts: synced before,
// silent over 12 h, seen playing since) finds them with a last contact after the 9.3.7 release, or when their latest reported companion
// version is a known-broken one and silent over 2 h; never when a newer version than 9.3.7 reported since. Never repeated (CompanionNotice),
// skipped quietly when DMs are closed, no mentions. Runs ~10 minutes after startup and hourly until NOTICE_END. Only COMPANION_937_NOTICE=on
// sends; the default is a dry run that only logs, and =off disables it.

export const NOTICE_KIND = "companion-9.3.7";
export const BROKEN_VERSION = "9.3.7";
/** When 9.3.7 reached the website. */
export const RELEASE_AT = new Date("2026-11-16T20:27:00Z");
export const NOTICE_END = new Date("2026-11-24T00:00:00Z");
export const SILENT_MS = 2 * 3_600_000;
export const STALLED_MS = 12 * 3_600_000;
export const SEND_GAP_MS = 1000;

/** The sync-health fields this job reads (the silent and broken-version lines). */
export interface SeenRow { memberId: string; signal: "silent" | "broken-version"; lastContact: Date; version: string | null }

export function seenRows(issues: readonly SyncIssue[]): SeenRow[] {
  return issues.flatMap((issue) => issue.memberId && issue.lastContact && (issue.signal === "silent" || issue.signal === "broken-version")
    ? [{ memberId: issue.memberId, signal: issue.signal, lastContact: issue.lastContact, version: issue.version ?? null }] : []);
}

/** Pure: the member ids to tell. */
export function eligibleMembers(rows: readonly SeenRow[], now: Date): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.version && row.version !== BROKEN_VERSION && versionBelow(BROKEN_VERSION, row.version)) continue; // a newer release reported since
    const silentFor = now.getTime() - row.lastContact.getTime();
    const broken = Boolean(row.version && KNOWN_BROKEN_VERSIONS[row.version]) && silentFor >= SILENT_MS;
    const stalled = row.signal === "silent" && row.lastContact >= RELEASE_AT && silentFor >= STALLED_MS;
    if (broken || stalled) ids.add(row.memberId);
  }
  return [...ids];
}

export function noticeText(language: string | null | undefined, url = siteUrl("/companion/")): string {
  return language === "fr"
    ? `Votre compagnon Guilded semble avoir cessé de se synchroniser depuis le 16 novembre. S'il s'est fermé après sa mise à jour (une erreur dans la version 9.3.7, désolés), téléchargez et lancez l'installateur une seule fois : ${url}
Vos réglages et vos liens sont conservés. Si vous l'avez fermé volontairement, vous pouvez ignorer ce message.`
    : `Your Guilded Companion seems to have stopped syncing since 16 November. If it closed after updating (a 9.3.7 packaging mistake on our side, sorry), download and run the installer once: ${url}
Your settings and links are kept. If you closed it on purpose, you can ignore this.`;
}

export type Database = Pick<PrismaClient, "guild" | "member" | "guildSettings" | "companionNotice" | "companionCredential" | "companionDevice" | "dungeonRunPlayer" | "duelResult" | "carriedRecord" | "dungeonRun" | "dungeonRunReceipt" | "dungeonRunWitness" | "syncHealthReport" | "guildRosterEntry" | "character">;
export interface Target { discordUserId: string; guildDiscordId: string; language: string | null }

async function collect(db: Database, now: Date, allows: (guildDiscordId: string) => boolean): Promise<Target[]> {
  const guilds = (await db.guild.findMany({ select: { id: true, discordId: true } })).filter((guild) => allows(guild.discordId));
  const targets = new Map<string, Target>();
  for (const guild of guilds) {
    const ids = eligibleMembers(seenRows(await collectSyncIssues(db, guild.id, now, 1_000)), now);
    if (!ids.length) continue;
    const [members, settings] = await Promise.all([
      db.member.findMany({ where: { id: { in: ids }, guildId: guild.id, status: "ACTIVE" }, select: { discordUserId: true } }),
      db.guildSettings.findUnique({ where: { guildId: guild.id }, select: { language: true } })
    ]);
    for (const member of members) if (!targets.has(member.discordUserId)) targets.set(member.discordUserId, { discordUserId: member.discordUserId, guildDiscordId: guild.discordId, language: settings?.language ?? null });
  }
  return [...targets.values()];
}

export interface PassResult { eligible: number; sent: number; closed: number; skipped: number; dry: boolean }

/**
 * One pass. `mode` "dry" logs who would be told and sends nothing. The marker row is created first (unique per user and kind), so two
 * passes or two instances never send twice; a closed DM keeps its marker (never retried), any other failure removes it so the next hour retries.
 */
export async function runNoticePass(client: Client | null, db: Database, options: { now?: Date; mode?: string | undefined; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void; allows?: (guildDiscordId: string) => boolean } = {}): Promise<PassResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.info(line));
  const dry = options.mode !== "on";
  const result: PassResult = { eligible: 0, sent: 0, closed: 0, skipped: 0, dry };
  if (now.getTime() >= NOTICE_END.getTime() || options.mode === "off") return result;
  const allows = options.allows ?? ((id: string) => hostedPilot.allows(id));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const rows = await collect(db, now, allows);
  const told = new Set((await db.companionNotice.findMany({ where: { kind: NOTICE_KIND, discordUserId: { in: rows.map((row) => row.discordUserId) } }, select: { discordUserId: true } })).map((row) => row.discordUserId));
  const todo = rows.filter((row) => !told.has(row.discordUserId));
  result.eligible = todo.length;
  result.skipped = rows.length - todo.length;
  if (dry) {
    for (const row of todo) log(`Companion 9.3.7 notice (dry run): would DM user ${row.discordUserId} (${row.language === "fr" ? "fr" : "en"}).`);
  } else if (client) {
    for (const row of todo) {
      try {
        await db.companionNotice.create({ data: { discordUserId: row.discordUserId, kind: NOTICE_KIND } });
      } catch { result.skipped++; continue; } // another pass already holds the marker
      try {
        const user = await client.users.fetch(row.discordUserId);
        await user.send({ content: noticeText(row.language), allowedMentions: { parse: [] } });
        await db.companionNotice.update({ where: { discordUserId_kind: { discordUserId: row.discordUserId, kind: NOTICE_KIND } }, data: { outcome: "sent" } });
        result.sent++;
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === 50007) {
          await db.companionNotice.update({ where: { discordUserId_kind: { discordUserId: row.discordUserId, kind: NOTICE_KIND } }, data: { outcome: "closed" } }).catch(() => undefined);
          result.closed++;
        } else {
          await db.companionNotice.delete({ where: { discordUserId_kind: { discordUserId: row.discordUserId, kind: NOTICE_KIND } } }).catch(() => undefined);
        }
      }
      await sleep(SEND_GAP_MS);
    }
  }
  log(`Companion 9.3.7 notice${dry ? " (dry run)" : ""}: eligible ${result.eligible}, sent ${result.sent}, skipped closed DMs ${result.closed}, already told ${result.skipped}.`);
  return result;
}

/** Starts the job: first pass 10 minutes after startup, then hourly until NOTICE_END. */
export function startCompanionNotice(client: Client, db: Database, mode: string | undefined = process.env["COMPANION_937_NOTICE"], report: (error: unknown) => void = () => undefined): void {
  if (Date.now() >= NOTICE_END.getTime() || mode === "off") return;
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try { await runNoticePass(client, db, { mode }); } catch (error) { report(error); } finally { running = false; }
  };
  setTimeout(() => {
    void pass();
    const timer = setInterval(() => { if (Date.now() >= NOTICE_END.getTime()) clearInterval(timer); else void pass(); }, 3_600_000);
    timer.unref();
  }, 10 * 60_000).unref();
}
