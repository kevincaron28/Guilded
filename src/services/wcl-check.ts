import type { Client, Guild as DiscordGuild } from "discord.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { createWclClient, type ReportRef, type WclReport, type WclReportStub } from "../integrations/warcraftlogs.js";
import { wclEmbed } from "../commands/wcl.js";
import { asLang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { notify, notifyEmbed } from "./notify.js";
import { reportUrl, saveReport } from "./wcl.js";
import { buildDetails, compareAttendance, formatOfficerCheck, type AttendanceCheck, type WclDetails } from "./wcl-analysis.js";

// Finding a guild's new Warcraft Logs reports by itself, attaching each to the raid it
// belongs to, and the officer-only check (attendance against the log, flasks, food, deaths).

type WclClient = ReturnType<typeof createWclClient>;
type Db = PrismaClient;

const MAX_AGE_MS = 3 * 24 * 3_600_000; // never backfill older reports
const SETTLE_MS = 15 * 60_000;         // a log that just ended may still be growing: wait
const RAID_TOLERANCE_MS = 3 * 3_600_000;

interface RaidWindow { id: string; title: string; scheduledAt: Date; startedAt: Date | null; endedAt: Date | null; }

// The raid a log belongs to: the one whose recorded time overlaps the log, otherwise the one
// scheduled closest to the log's start (within a few hours). Null when nothing fits.
export function matchRaid<T extends RaidWindow>(raids: readonly T[], report: { startTime: number; endTime: number }): T | null {
  let best: { raid: T; overlaps: boolean; distance: number } | null = null;
  for (const raid of raids) {
    const started = raid.startedAt?.getTime();
    const ended = raid.endedAt?.getTime() ?? (started !== undefined ? started + 8 * 3_600_000 : undefined);
    const overlaps = started !== undefined && ended !== undefined && started <= report.endTime && ended >= report.startTime;
    const distance = Math.abs((started ?? raid.scheduledAt.getTime()) - report.startTime);
    if (!overlaps && Math.abs(raid.scheduledAt.getTime() - report.startTime) > RAID_TOLERANCE_MS) continue;
    // A raid whose recorded time overlaps the log beats one that is only scheduled near it.
    if (!best || (overlaps && !best.overlaps) || (overlaps === best.overlaps && distance < best.distance)) best = { raid, overlaps, distance };
  }
  return best?.raid ?? null;
}

const bossFightIds = (report: WclReport) => report.fights.filter((fight) => fight.encounterID > 0).map((fight) => fight.id);

// Fetches the per-pull data, compares attendance when the log is linked to a raid, and keeps
// the details on the saved report. Never used in public posts.
export async function checkReport(
  database: Db, client: WclClient,
  input: { guildId: string; report: WclReport; ref: ReportRef; raidId: string | null }
): Promise<{ attendance: AttendanceCheck | null; details: WclDetails | null; text: string }> {
  const ids = bossFightIds(input.report);
  let details: WclDetails | null = null;
  try {
    details = buildDetails(input.report, await client.fetchDetails(input.ref, ids));
  } catch (error) {
    console.warn("Warcraft Logs details unavailable:", error instanceof Error ? error.message : error);
  }
  let attendance: AttendanceCheck | null = null;
  if (input.raidId) {
    const [characters, rows, paid] = await Promise.all([
      database.character.findMany({ where: { member: { guildId: input.guildId } }, select: { name: true, realm: true, memberId: true, member: { select: { displayName: true } } } }),
      database.raidAttendance.findMany({ where: { raidId: input.raidId }, select: { memberId: true, status: true, member: { select: { displayName: true } } } }),
      database.epgpTransaction.findMany({ where: { guildId: input.guildId, sourceRef: { startsWith: `raid-ep:${input.raidId}:` } }, select: { memberId: true } })
    ]);
    attendance = compareAttendance({
      logPlayers: input.report.players.map((player) => player.name),
      characters: characters.map((c) => ({ name: c.name, realm: c.realm, memberId: c.memberId, memberName: c.member.displayName })),
      attendance: rows.map((r) => ({ memberId: r.memberId, memberName: r.member.displayName, status: r.status })),
      epPaidMemberIds: new Set(paid.map((row) => row.memberId))
    });
  }
  if (details) {
    await database.warcraftLogsReport.updateMany({
      where: { guildId: input.guildId, code: input.report.code },
      data: { details: details as unknown as Prisma.InputJsonValue }
    });
  }
  return { attendance, details, text: formatOfficerCheck({ title: input.report.title, attendance, details }) };
}

async function processReport(
  database: Db, client: WclClient, discordGuild: DiscordGuild | null,
  input: { guildId: string; baseUrl: string; stub: WclReportStub }
): Promise<boolean> {
  const { stub } = input;
  const now = Date.now();
  if (stub.endTime > now - SETTLE_MS || stub.endTime < now - MAX_AGE_MS) return false;
  if (await database.warcraftLogsReport.findUnique({ where: { guildId_code: { guildId: input.guildId, code: stub.code } }, select: { id: true } })) return false;

  const ref: ReportRef = { code: stub.code, baseUrl: input.baseUrl };
  const report = await client.fetchReport(ref);
  const raids = await database.raid.findMany({
    where: { guildId: input.guildId, isTest: false, status: { not: "CANCELLED" }, scheduledAt: { gte: new Date(report.startTime - 2 * 24 * 3_600_000), lte: new Date(report.endTime + 24 * 3_600_000) } },
    select: { id: true, title: true, scheduledAt: true, startedAt: true, endedAt: true }
  });
  const raid = matchRaid(raids, report);
  const { summary } = await saveReport(database, { guildId: input.guildId, report, baseUrl: input.baseUrl, raidId: raid?.id ?? null, createdBy: "wcl-auto" });
  if (summary.bosses.length === 0) return true; // saved so it is not fetched again, but nothing to announce (dungeon or trash log)

  const check = await checkReport(database, client, { guildId: input.guildId, report, ref, raidId: raid?.id ?? null });
  if (discordGuild) {
    await notifyEmbed(discordGuild, wclEmbed(report.title, reportUrl(input.baseUrl, report.code), report.zone?.name ?? null, summary, raid?.title, asLang((await createGuildService(database).getSettings(input.guildId))?.language)), "raidLog");
    await notify(discordGuild, check.text, "officer");
  }
  return true;
}

// Looks at every guild that set a Warcraft Logs guild (/config wcl-guild). Called every few minutes.
export async function runWclDiscovery(discord: Client, database: Db): Promise<number> {
  if (!config.WCL_CLIENT_ID || !config.WCL_CLIENT_SECRET) return 0;
  const client = createWclClient({ clientId: config.WCL_CLIENT_ID, clientSecret: config.WCL_CLIENT_SECRET });
  const settings = await database.guildSettings.findMany({ where: { wclGuildId: { not: null } }, select: { guildId: true, wclGuildId: true, wclBaseUrl: true } });
  let found = 0;
  for (const row of settings) {
    if (!row.wclGuildId) continue;
    try {
      const guild = await database.guild.findUnique({ where: { id: row.guildId }, select: { discordId: true } });
      const discordGuild = guild ? await discord.guilds.fetch(guild.discordId).catch(() => null) : null;
      const baseUrl = (row.wclBaseUrl ?? config.WCL_BASE_URL).replace(/\/+$/, "");
      const stubs = await client.listGuildReports(baseUrl, row.wclGuildId, 15);
      for (const stub of stubs) {
        try {
          if (await processReport(database, client, discordGuild, { guildId: row.guildId, baseUrl, stub })) found++;
        } catch (error) {
          console.warn(`Warcraft Logs report ${stub.code} skipped:`, error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      console.warn("Warcraft Logs discovery skipped:", error instanceof Error ? error.message : error);
    }
  }
  return found;
}
