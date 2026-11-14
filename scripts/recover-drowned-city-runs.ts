// One-off: completes the Drowned City runs stored ABANDONED although their group killed Min'loth the Serpent (the final boss).
// Each run ends at that kill; anything recorded after it is dropped (it belongs to a new run), and every player's observed presence is
// clipped to the new end. The run is then upgraded once through the ordinary import, like a run the addon sends again as COMPLETED.
// The original report is kept on the stored run (competitionData.recovery) with the old state, old end and the dropped kills.
//
//   npx tsx scripts/recover-drowned-city-runs.ts [guildId]           dry run: prints what would change and each player's points, writes nothing
//   npx tsx scripts/recover-drowned-city-runs.ts [guildId] --apply   applies it (one transaction per server)
//
// No Discord client is started and no announcement is queued; the dungeon board refreshes at its next scheduled update.
import type { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/database.js";
import { integrityPresence, withIntegrityWindow } from "../src/services/dungeon-integrity.js";
import { importDungeonRuns, peerVouched } from "../src/services/dungeon-import.js";
import { bracketedVerdict, presentEnough, verdictPoints } from "../src/services/dungeon-rating.js";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { completeAtFinalBoss } from "../src/services/dungeon-recovery.js";
import { dungeonRunSchema, validateRun } from "../src/services/dungeon-rules.js";

const INSTANCE_ID = 2970;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.find((arg) => !arg.startsWith("--"));
if (args.some((arg) => arg.startsWith("--") && arg !== "--apply")) throw new Error("Usage: tsx scripts/recover-drowned-city-runs.ts [guildId] [--apply]");

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

try {
  const guildIds = only ? [only] : (await prisma.dungeonRun.findMany({ where: { instanceId: INSTANCE_ID, state: { not: "COMPLETED" } }, distinct: ["guildId"], select: { guildId: true } })).map((row) => row.guildId);
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${guildIds.length} server(s) with Drowned City runs that are not completed`);
  let changed = 0;
  for (const guildId of guildIds) {
    const rows = await prisma.dungeonRun.findMany({
      where: { guildId, instanceId: INSTANCE_ID, state: { not: "COMPLETED" } }, orderBy: { startedAt: "asc" }, take: 200,
      select: { id: true, runRef: true, state: true, startedAt: true, endedAt: true, durationSec: true, importId: true, competitionData: true }
    });
    const season = await prisma.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    const rules = season && validBracketedRules(season.ratingRules) ? withIntegrityWindow(season.ratingRules, season.startsAt, season.endsAt) : null;
    const prepared: { row: (typeof rows)[number]; run: ReturnType<typeof dungeonRunSchema.parse>; raw: unknown; dropped: unknown[]; endedAt: number }[] = [];
    for (const row of rows) {
      const data = row.competitionData as { observerReports?: unknown[] } | null;
      // The stored report of exactly this run; never another run's.
      let raw: unknown = data?.observerReports?.find((entry) => isRecord(entry) && entry["id"] === row.runRef);
      if (!raw && row.importId) {
        const original = await prisma.addonImport.findFirst({ where: { id: row.importId, guildId } });
        raw = (original?.payload as { dungeonRuns?: unknown[] } | null)?.dungeonRuns?.find((entry) => isRecord(entry) && entry["id"] === row.runRef);
      }
      if (!raw) { console.log(`  ${row.runRef}: skipped (the stored report of this run was not found)`); continue; }
      const completed = completeAtFinalBoss(raw);
      if ("skip" in completed) { console.log(`  ${row.runRef}: skipped (${completed.skip})`); continue; }
      const parsed = dungeonRunSchema.safeParse(completed.run);
      if (!parsed.success) { console.log(`  ${row.runRef}: skipped (the completed run is not readable: ${parsed.error.issues[0]?.path.join(".")})`); continue; }
      const check = validateRun(parsed.data);
      if (!check.ok) { console.log(`  ${row.runRef}: skipped (${check.reason})`); continue; }
      if (peerVouched(parsed.data)) { console.log(`  ${row.runRef}: skipped (it holds peer-sourced kills: the import would hold it for a guildmate's own copy and answer "retry")`); continue; }
      const seconds = completed.endedAt - (parsed.data.startedAt ?? completed.endedAt);
      console.log(`  ${row.runRef}: ${row.state} -> COMPLETED; ends ${iso(completed.endedAt)} (was ${row.endedAt?.toISOString() ?? "none"}), ${seconds} s (was ${row.durationSec ?? "none"} s), ${completed.trimmed} later kill record(s) dropped, ${parsed.data.players.length} players`);
      if (rules) {
        const began = parsed.data.startedAt;
        const ratingRun = { instanceId: INSTANCE_ID, difficultyId: parsed.data.difficultyId, durationSec: seconds, startedAt: began ? new Date(began * 1000) : null, endedAt: new Date(completed.endedAt * 1000),
          createdAt: new Date(), completedBy: "final boss", runRef: row.runRef,
          competitionData: { integrity: parsed.data.integrity, players: parsed.data.players.map((p) => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null, integrity: p.integrity })), encounters: parsed.data.encounters ?? [] },
          players: parsed.data.players.map((p) => ({ character: p.character, memberId: null, presentSec: p.presentSec, member: null })) };
        const verdict = bracketedVerdict(ratingRun, rules);
        for (const p of parsed.data.players) {
          const present = presentEnough(p.presentSec, seconds);
          const observed = rules.evidencePolicy !== "current-v2" || integrityPresence(p.integrity, seconds, began);
          const points = verdict.reason ? `no points (${verdict.reason})` : !present ? "no points (presence under 80%)" : !observed ? "no points (known in-instance presence under 80%)" : `${verdictPoints(seconds, verdict)} points`;
          console.log(`      ${p.character}: ${points}`);
        }
      } else console.log("      (no rated season for this server: points not shown)");
      prepared.push({ row, run: parsed.data, raw, dropped: completed.dropped, endedAt: completed.endedAt });
    }
    if (!apply || !prepared.length) { changed += prepared.length; continue; }
    const summary = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
      const characters = await tx.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, memberId: true } });
      const results = [];
      for (const { row, run, raw, dropped, endedAt } of prepared) {
        const result = await importDungeonRuns(tx, guildId, [run], characters, "recover:drowned-city", row.importId);
        // Keep the original ABANDONED report next to the completed one.
        const stored = await tx.dungeonRun.findUnique({ where: { id: row.id }, select: { competitionData: true } });
        const data = isRecord(stored?.competitionData) ? stored.competitionData : {};
        const recovery = { at: new Date().toISOString(), by: "recover-drowned-city-runs", oldState: row.state, oldEndedAt: row.endedAt?.toISOString() ?? null, oldDurationSec: row.durationSec, newEndedAt: iso(endedAt), droppedEncounters: dropped, originalReport: raw };
        await tx.dungeonRun.update({ where: { id: row.id }, data: { competitionData: { ...data, recovery } as unknown as Prisma.InputJsonValue } });
        results.push(result);
      }
      return results;
    }, { timeout: 60_000 });
    for (const [index, result] of summary.entries()) console.log(`  ${prepared[index]!.row.runRef}: ${result.results.length ? `imported (valid=${result.results[0]!.valid})` : `not imported (duplicates=${result.duplicates}, malformed=${result.malformed})`}`);
    changed += prepared.length;
  }
  console.log(`${apply ? "Completed" : "Would complete"} ${changed} run(s).${apply ? "" : " Re-run with --apply to write."}`);
} finally {
  await prisma.$disconnect();
}
