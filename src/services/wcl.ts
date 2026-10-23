import type { Prisma, PrismaClient } from "@prisma/client";
import type { WclReport } from "../integrations/warcraftlogs.js";

// Compact summary of a Warcraft Logs report: what was fought and how it went,
// deliberately no per-player damage/healing numbers.
export interface WclSummary {
  durationMinutes: number;
  bosses: { name: string; kills: number; wipes: number; bestKillSec: number | null }[];
  bossesKilled: number;
  totalWipes: number;
  players: { name: string; className: string }[];
}

export function summarizeReport(report: WclReport): WclSummary {
  const byBoss = new Map<string, { name: string; kills: number; wipes: number; bestKillSec: number | null }>();
  for (const fight of report.fights) {
    if (fight.encounterID <= 0) continue; // trash pulls
    const row = byBoss.get(fight.name) ?? { name: fight.name, kills: 0, wipes: 0, bestKillSec: null };
    if (fight.kill) {
      row.kills++;
      const seconds = Math.round((fight.endTime - fight.startTime) / 1000);
      row.bestKillSec = row.bestKillSec === null ? seconds : Math.min(row.bestKillSec, seconds);
    } else {
      row.wipes++;
    }
    byBoss.set(fight.name, row);
  }
  const bosses = [...byBoss.values()];
  return {
    durationMinutes: Math.max(0, Math.round((report.endTime - report.startTime) / 60_000)),
    bosses,
    bossesKilled: bosses.filter((boss) => boss.kills > 0).length,
    totalWipes: bosses.reduce((sum, boss) => sum + boss.wipes, 0),
    players: report.players
  };
}

export function reportUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/reports/${code}`;
}

// Re-running /raid wcl without a raid must not unlink an earlier one.
function withoutRaid<T extends { raidId: string | null }>(data: T): Omit<T, "raidId"> {
  const copy = { ...data } as Partial<T>;
  delete copy.raidId;
  return copy as Omit<T, "raidId">;
}

export async function saveReport(
  database: PrismaClient,
  input: { guildId: string; report: WclReport; baseUrl: string; raidId: string | null; createdBy: string }
) {
  const summary = summarizeReport(input.report);
  const data = {
    url: reportUrl(input.baseUrl, input.report.code),
    title: input.report.title,
    zone: input.report.zone?.name ?? null,
    owner: input.report.owner?.name ?? null,
    startedAt: new Date(input.report.startTime),
    endedAt: new Date(input.report.endTime),
    summary: summary as unknown as Prisma.InputJsonValue,
    raidId: input.raidId
  };
  const saved = await database.warcraftLogsReport.upsert({
    where: { guildId_code: { guildId: input.guildId, code: input.report.code } },
    create: { guildId: input.guildId, code: input.report.code, createdBy: input.createdBy, ...data },
    // Re-running on the same code refreshes it (a live log grows); keep an earlier raid link unless a new one is given.
    update: input.raidId ? data : withoutRaid(data)
  });
  return { saved, summary };
}

export async function linkedReport(database: Pick<PrismaClient, "warcraftLogsReport">, guildId: string, raidId: string) {
  return database.warcraftLogsReport.findFirst({ where: { guildId, raidId }, orderBy: { startedAt: "desc" } });
}
