import type { PrismaClient } from "../generated/prisma/client.js";

type SummaryRow = { kind: string; userId: string | null; points: number; participants: number };

// Aggregate on the database: a status request must not copy a season's entire
// ledger (including reasons and actor IDs) into the bot. At most six rows return.
// The calling service first checks that the season belongs to the requested guild.
export async function participationSummaryTotals(database: Pick<PrismaClient, "$queryRaw">, seasonId: string, userId: string, weekStart: Date, now: Date) {
  const rows = await database.$queryRaw<SummaryRow[]>`
    WITH weekly_totals AS (
      SELECT "userId", SUM(amount) AS points
      FROM "CommunityPoint"
      WHERE "seasonId" = ${seasonId} AND kind IN ('AWARD', 'REVERSAL')
        AND "createdAt" >= ${weekStart} AND "createdAt" <= ${now}
      GROUP BY "userId"
    ), helpers AS (
      SELECT entry."userId", SUM(entry.amount)::double precision AS points
      FROM "CommunityPoint" entry
      LEFT JOIN "CommunityPoint" original
        ON entry.kind = 'REVERSAL' AND original.kind = 'AWARD'
        AND original."seasonId" = entry."seasonId"
        AND entry.reference LIKE 'participation:reverse:%'
        AND original.id = substr(entry.reference, length('participation:reverse:') + 1)
      WHERE entry."seasonId" = ${seasonId} AND entry.kind IN ('AWARD', 'REVERSAL')
        AND entry."createdAt" >= ${weekStart} AND entry."createdAt" <= ${now}
        AND CASE WHEN entry.kind = 'AWARD' THEN entry.reference ELSE original.reference END LIKE 'participation:helper:%'
      GROUP BY entry."userId"
      HAVING SUM(entry.amount) > 0
      ORDER BY points DESC, entry."userId" ASC
      LIMIT 5
    )
    SELECT 'summary'::text AS kind, NULL::text AS "userId",
      (SELECT COALESCE(SUM(amount), 0)::double precision FROM "CommunityPoint"
       WHERE "seasonId" = ${seasonId} AND "userId" = ${userId} AND kind IN ('AWARD', 'REVERSAL')) AS points,
      (SELECT COUNT(*)::integer FROM weekly_totals WHERE points > 0) AS participants
    UNION ALL
    SELECT 'helper'::text, "userId", points, 0::integer FROM helpers
  `;
  const summary = rows.find(row => row.kind === "summary");
  if (!summary) throw new Error("Participation summary unavailable.");
  const helpers: [string, number][] = rows.filter(row => row.kind === "helper" && row.userId !== null)
    .map(row => [row.userId!, row.points]);
  helpers.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { points: summary.points, participants: summary.participants, helpers };
}
