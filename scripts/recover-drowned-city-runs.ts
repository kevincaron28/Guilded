// One-off: completes the Drowned City runs stored ABANDONED although their group killed Min'loth the Serpent (the final boss).
// Each run ends at that kill; anything recorded after it is dropped (it belongs to a new run). The run is then upgraded once through
// the ordinary import, like a run the addon sends again as COMPLETED.
//
//   npx tsx scripts/recover-drowned-city-runs.ts [guildId]           dry run: prints what would change, writes nothing
//   npx tsx scripts/recover-drowned-city-runs.ts [guildId] --apply   applies it (one transaction per server)
//
// No Discord client is started and no announcement is queued; the dungeon board refreshes at its next scheduled update.
import { prisma } from "../src/database.js";
import { dungeonRunSchema, validateRun } from "../src/services/dungeon-rules.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { completeAtFinalBoss } from "../src/services/dungeon-recovery.js";

const INSTANCE_ID = 2970;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.find((arg) => !arg.startsWith("--"));
if (args.some((arg) => arg.startsWith("--") && arg !== "--apply")) throw new Error("Usage: tsx scripts/recover-drowned-city-runs.ts [guildId] [--apply]");

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

try {
  const stored = await prisma.dungeonRun.findMany({
    where: { instanceId: INSTANCE_ID, state: { not: "COMPLETED" }, ...(only ? { guildId: only } : {}) },
    orderBy: { startedAt: "asc" }, take: 200,
    select: { id: true, guildId: true, runRef: true, state: true, startedAt: true, endedAt: true, durationSec: true, importId: true, competitionData: true }
  });
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${stored.length} stored Drowned City run(s) that are not completed`);
  const byGuild = new Map<string, typeof stored>();
  for (const row of stored) byGuild.set(row.guildId, [...(byGuild.get(row.guildId) ?? []), row]);
  let changed = 0;
  for (const [guildId, rows] of byGuild) {
    const prepared: { row: (typeof stored)[number]; run: ReturnType<typeof dungeonRunSchema.parse> }[] = [];
    for (const row of rows) {
      const data = row.competitionData as { observerReports?: unknown[] } | null;
      let raw: unknown = data?.observerReports?.find((entry) => entry && typeof entry === "object" && (entry as { id?: unknown }).id === row.runRef) ?? data?.observerReports?.[0];
      if (!raw && row.importId) {
        const original = await prisma.addonImport.findFirst({ where: { id: row.importId, guildId } });
        raw = (original?.payload as { dungeonRuns?: unknown[] } | null)?.dungeonRuns?.find((entry) => entry && typeof entry === "object" && (entry as { id?: unknown }).id === row.runRef);
      }
      const completed = completeAtFinalBoss(raw);
      if ("skip" in completed) { console.log(`  ${row.runRef}: skipped (${completed.skip})`); continue; }
      const parsed = dungeonRunSchema.safeParse(completed.run);
      if (!parsed.success) { console.log(`  ${row.runRef}: skipped (the completed run is not readable: ${parsed.error.issues[0]?.path.join(".")})`); continue; }
      const check = validateRun(parsed.data);
      if (!check.ok) { console.log(`  ${row.runRef}: skipped (${check.reason})`); continue; }
      const seconds = completed.endedAt - (parsed.data.startedAt ?? completed.endedAt);
      console.log(`  ${row.runRef}: ${row.state} -> COMPLETED; ends ${iso(completed.endedAt)} (was ${row.endedAt?.toISOString() ?? "none"}), ${seconds} s (was ${row.durationSec ?? "none"} s), ${completed.trimmed} later kill record(s) dropped, ${parsed.data.players.length} players`);
      prepared.push({ row, run: parsed.data });
    }
    if (!apply || !prepared.length) { changed += prepared.length; continue; }
    const summary = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const characters = await tx.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, memberId: true } });
      const results = [];
      for (const { row, run } of prepared) results.push(await importDungeonRuns(tx, guildId, [run], characters, "recover:drowned-city", row.importId));
      return results;
    }, { timeout: 60_000 });
    for (const [index, result] of summary.entries()) console.log(`  ${prepared[index]!.row.runRef}: ${result.results.length ? `imported (valid=${result.results[0]!.valid})` : `not imported (duplicates=${result.duplicates}, malformed=${result.malformed})`}`);
    changed += prepared.length;
  }
  console.log(`${apply ? "Completed" : "Would complete"} ${changed} run(s).${apply ? "" : " Re-run with --apply to write."}`);
} finally {
  await prisma.$disconnect();
}
