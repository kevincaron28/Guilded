import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const POE_MODES = ["STANDARD", "HARDCORE", "SSF", "SSF_HARDCORE"] as const;
const label = z.string().trim().min(1).max(100).refine(value => !/\p{Cc}/u.test(value));
export const poeVisitSchema = z.object({
  runRef: z.string().regex(/^[a-f0-9]{64}$/),
  // Hash of area + seed; portal re-entries share it. Older companions omit it.
  instanceRef: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  character: label,
  league: label,
  mode: z.enum(POE_MODES),
  areaId: z.string().regex(/^Map(?!Worlds)[A-Za-z0-9_]{1,96}$/),
  areaLevel: z.number().int().min(1).max(100),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  endReason: z.enum(["AREA_CHANGED", "INTERRUPTED"])
}).strict().refine(row => Date.parse(row.endedAt) >= Date.parse(row.startedAt), "Visit ends before it starts.");
export const poeUploadSchema = z.object({
  guildDiscordId: z.string().min(1).max(30),
  visits: z.array(poeVisitSchema).min(1).max(100)
}).strict();

// "MapHiddenGrotto" -> "Hidden Grotto". Display only; areaId stays the stored key.
export function poeAreaName(areaId: string): string {
  const name = areaId.replace(/^Map/, "").replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2");
  return name.replace(/\s+/g, " ").trim() || areaId;
}

// League names are typed in the companion, so match them without case.
const leagueFilter = (league: string) => ({ equals: league, mode: "insensitive" as const });

export class PoeMappingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function createPoeMappingService(database: PrismaClient) {
  return {
    async ingest(guildId: string, memberId: string, payload: unknown, now = new Date()) {
      const { visits } = poeUploadSchema.parse(payload);
      // The API supplies memberId from the personal credential, never from the body.
      return database.$transaction(async tx => {
        const settings = await tx.guildSettings.findUnique({ where: { guildId } });
        if (!settings?.poeTrackingEnabled) throw new PoeMappingError("PoE2 tracking is disabled. An officer can enable it with /poe setup.", 403);
        const member = await tx.member.findFirst({ where: { id: memberId, guildId, status: "ACTIVE" }, select: { id: true } });
        if (!member) throw new PoeMappingError("This Discord member is not active in this guild.", 403);
        const accepted = visits.filter(row => !settings.dataResetAt || Date.parse(row.startedAt) > settings.dataResetAt.getTime());
        if (accepted.some(row => Date.parse(row.endedAt) > now.getTime() + 5 * 60_000)) {
          throw new PoeMappingError("Visit timestamp is in the future. Check the companion computer clock.", 400);
        }
        const result = accepted.length ? await tx.poeMapVisit.createMany({ data: accepted.map(row => {
          const elapsed = Math.floor((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 1000);
          return { ...row, instanceRef: row.instanceRef ?? null, guildId, memberId, startedAt: new Date(row.startedAt), endedAt: new Date(row.endedAt),
            durationSeconds: row.endReason === "AREA_CHANGED" && elapsed <= 21_600 ? elapsed : null };
        }), skipDuplicates: true }) : { count: 0 };
        // Acknowledging reset-excluded rows prevents the client retrying old history forever.
        return { inserted: result.count, acceptedRunRefs: visits.map(row => row.runRef), excludedByReset: visits.length - accepted.length };
      });
    },
    recent(guildId: string, memberId: string, league?: string) {
      return database.poeMapVisit.findMany({ where: { guildId, memberId, ...(league ? { league: leagueFilter(league) } : {}) }, orderBy: { startedAt: "desc" }, take: 15 });
    },
    async summary(guildId: string, league: string, mode: typeof POE_MODES[number], days: number, memberId?: string, now = new Date()) {
      const where = { guildId, league: leagueFilter(league), mode, startedAt: { gte: new Date(now.getTime() - days * 86_400_000) }, ...(memberId ? { memberId } : {}) };
      // One group per member and map instance: a map entered through several
      // portals is one map. Visits without an instanceRef (older companions) count as their own map.
      const groups = await database.poeMapVisit.groupBy({ by: ["memberId", "instanceRef"], where, _count: { _all: true, durationSeconds: true }, _sum: { durationSeconds: true } });
      const totals = new Map<string, { maps: number; visits: number; timedVisits: number; seconds: number }>();
      for (const group of groups) {
        const total = totals.get(group.memberId) ?? { maps: 0, visits: 0, timedVisits: 0, seconds: 0 };
        total.maps += group.instanceRef ? 1 : group._count._all;
        total.visits += group._count._all;
        total.timedVisits += group._count.durationSeconds;
        total.seconds += group._sum.durationSeconds ?? 0;
        totals.set(group.memberId, total);
      }
      const top = [...totals].sort((a, b) => b[1].maps - a[1].maps || b[1].visits - a[1].visits).slice(0, 15);
      const members = await database.member.findMany({ where: { guildId, id: { in: top.map(([id]) => id) } }, select: { id: true, displayName: true } });
      return top.map(([id, total]) => ({ memberId: id, name: members.find(member => member.id === id)?.displayName ?? "Member", ...total }));
    },
    // Leagues already observed in this guild, most recently played first.
    async leagueChoices(guildId: string, query: string) {
      const rows = await database.poeMapVisit.groupBy({ by: ["league"], where: { guildId, league: { contains: query.trim(), mode: "insensitive" } }, _max: { startedAt: true }, orderBy: { _max: { startedAt: "desc" } }, take: 25 });
      return rows.map(row => ({ name: row.league.slice(0, 100), value: row.league.slice(0, 100) }));
    }
  };
}
