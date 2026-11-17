import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { hostedPilot } from "../hosted-pilot.js";
import { siteUrl } from "../site-url.js";
import { hashCompanionSecret } from "./character-pairing.js";
import { cleanVersion } from "../compat.js";

// One direct message (owner decision, 17 November 2026: "One DM each"). The website companion 9.3.7 left run-log.cjs out of its package, so
// it cannot start and cannot update itself. A member whose companion last reported 9.3.7 and then went silent gets ONE DM to download the
// 9.3.8 installer. Never repeated (CompanionNotice marker), skipped quietly when DMs are closed, no mentions. Runs ~10 minutes after
// startup and hourly until NOTICE_END. The Store never shipped 9.3.7, so a Store install never reports it and is never eligible.

export const NOTICE_KIND = "companion-9.3.7";
export const BROKEN_VERSION = "9.3.7";
export const NOTICE_END = new Date("2026-11-24T00:00:00Z");
export const SILENT_MS = 2 * 3_600_000;
export const SEND_GAP_MS = 1000;

/** One credential or device key that reported a version: whose it is and when it last reported. */
export interface SeenRow { discordUserId: string; guildDiscordId: string; version: string | null; seenAt: Date | null; language: string | null }

/** Pure: the members to tell. The latest report across all of a member's credentials and devices decides: exactly 9.3.7 and silent for 2 hours. */
export function eligibleRows(rows: readonly SeenRow[], now: Date): SeenRow[] {
  const latest = new Map<string, SeenRow>();
  for (const row of rows) {
    if (!row.version || !row.seenAt) continue;
    const kept = latest.get(row.discordUserId);
    if (!kept || kept.seenAt!.getTime() < row.seenAt.getTime()) latest.set(row.discordUserId, row);
  }
  return [...latest.values()].filter((row) => row.version === BROKEN_VERSION && now.getTime() - row.seenAt!.getTime() >= SILENT_MS);
}

export function noticeText(language: string | null | undefined, url = siteUrl("/companion/")): string {
  return language === "fr"
    ? `Ton compagnon Guilded s'est arrêté après sa mise à jour vers la version 9.3.7 (une erreur d'emballage de notre part, désolé). Télécharge et lance l'installateur une seule fois pour le réparer : ${url}\nTes réglages et tes liens sont conservés.`
    : `Your Guilded Companion stopped after updating to 9.3.7 (a packaging mistake on our side, sorry). Download and run the installer once to fix it: ${url}\nYour settings and links are kept.`;
}

export type Database = Pick<PrismaClient, "companionCredential" | "companionDevice" | "companionNotice" | "guildSettings">;

async function collect(db: Database): Promise<SeenRow[]> {
  const [credentials, devices] = await Promise.all([
    db.companionCredential.findMany({ where: { revokedAt: null, companionVersion: { not: null }, member: { status: "ACTIVE" } },
      select: { companionVersion: true, companionVersionAt: true, member: { select: { discordUserId: true, guildId: true, guild: { select: { discordId: true } } } } } }),
    db.companionDevice.findMany({ where: { revokedAt: null, companionVersion: { not: null }, claimedMemberId: { not: null }, claimedMember: { status: "ACTIVE" } },
      select: { companionVersion: true, companionVersionAt: true, claimedMember: { select: { discordUserId: true, guildId: true, guild: { select: { discordId: true } } } } } })
  ]);
  const raw = [
    ...credentials.map((row) => ({ member: row.member, version: row.companionVersion, seenAt: row.companionVersionAt })),
    ...devices.map((row) => ({ member: row.claimedMember!, version: row.companionVersion, seenAt: row.companionVersionAt }))
  ];
  const settings = await db.guildSettings.findMany({ where: { guildId: { in: [...new Set(raw.map((row) => row.member.guildId))] } }, select: { guildId: true, language: true } });
  const language = new Map(settings.map((row) => [row.guildId, row.language]));
  return raw.map((row) => ({ discordUserId: row.member.discordUserId, guildDiscordId: row.member.guild.discordId, version: row.version, seenAt: row.seenAt, language: language.get(row.member.guildId) ?? null }));
}

export interface PassResult { eligible: number; sent: number; closed: number; skipped: number; dry: boolean }

/**
 * One pass. `mode` "dry" logs who would be told and sends nothing. The marker row is created first (unique per user and kind), so two
 * passes or two instances never send twice; a closed DM keeps its marker (never retried), any other failure removes it so the next hour retries.
 */
export async function runNoticePass(client: Client | null, db: Database, options: { now?: Date; mode?: string | undefined; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void; allows?: (guildDiscordId: string) => boolean } = {}): Promise<PassResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? ((line: string) => console.info(line));
  const dry = options.mode === "dry";
  const result: PassResult = { eligible: 0, sent: 0, closed: 0, skipped: 0, dry };
  if (now.getTime() >= NOTICE_END.getTime() || options.mode === "off") return result;
  const allows = options.allows ?? ((id: string) => hostedPilot.allows(id));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const rows = eligibleRows(await collect(db), now).filter((row) => allows(row.guildDiscordId));
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

// Recording which release called (the bot kept this only in memory). At most one write per secret and version per 30 minutes.
const noted = new Map<string, number>();
const NOTE_MS = 30 * 60_000;
export function noteCompanionVersion(db: Pick<PrismaClient, "companionCredential" | "companionDevice">, secrets: { credential?: string | undefined; device?: string | undefined }, rawVersion: unknown, now = new Date()): void {
  const version = cleanVersion(rawVersion);
  if (!version) return;
  const write = (kind: "credential" | "device", secret: string | undefined) => {
    if (!secret || secret.length < 32 || secret.length > 256) return;
    const tokenHash = hashCompanionSecret(secret);
    const key = `${kind}:${tokenHash}:${version}`;
    if (now.getTime() - (noted.get(key) ?? 0) < NOTE_MS) return;
    if (noted.size > 5000) noted.clear();
    noted.set(key, now.getTime());
    const data = { companionVersion: version, companionVersionAt: now };
    try {
      const promise = kind === "credential" ? db.companionCredential.updateMany({ where: { tokenHash }, data }) : db.companionDevice.updateMany({ where: { tokenHash }, data });
      void Promise.resolve(promise).catch(() => undefined);
    } catch { /* a test double without the model */ }
  };
  write("credential", secrets.credential);
  write("device", secrets.device);
}

export const resetNotedVersions = () => noted.clear();
