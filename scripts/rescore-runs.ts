// Completes stored runs of the given dungeon maps that are not COMPLETED although their group killed the dungeon's final boss (an older
// addon did not know that boss), e.g. Krol'dok Stronghold (3039) and Alcaz Prison (2994). Generalises recover-drowned-city-runs.ts:
// each run ends at the final boss kill, later kills are dropped, presence is clipped, and the run is upgraded once through the ordinary
// import. The original report is kept on the run (competitionData.recovery). Scores are computed when read, so nothing else is rewritten.
//
//   npx tsx scripts/rescore-runs.ts --instance 3039,2994 [guildId]           dry run: prints what would change and each player's points
//   npx tsx scripts/rescore-runs.ts --instance 3039,2994 [guildId] --apply   applies it (one transaction per server and map)
//
// Only maps with a known final boss (recoverableFinalBoss in dungeon-bosses.ts) are touched. No Discord client is started.
import type { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/database.js";
import { integrityPresence, withIntegrityWindow } from "../src/services/dungeon-integrity.js";
import { importDungeonRuns, peerVouched } from "../src/services/dungeon-import.js";
import { bracketedVerdict, penalized, presentEnough, timeRating } from "../src/services/dungeon-rating.js";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { recoverableFinalBoss } from "../src/services/dungeon-bosses.js";
import { completeAtFinalBoss } from "../src/services/dungeon-recovery.js";
import { dungeonRunSchema, validateRun } from "../src/services/dungeon-rules.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flag = args.indexOf("--instance");
const INSTANCE_IDS = (flag >= 0 ? (args[flag + 1] ?? "") : "").split(",").map((part) => Number(part.trim())).filter((id) => Number.isInteger(id) && id > 0);
const only = args.find((arg, index) => !arg.startsWith("--") && index !== flag + 1);
const usage = "Usage: tsx scripts/rescore-runs.ts --instance 3039,2994 [guildId] [--apply]";
if (!INSTANCE_IDS.length || args.some((arg) => arg.startsWith("--") && arg !== "--apply" && arg !== "--instance")) throw new Error(usage);
const unknown = INSTANCE_IDS.filter((id) => !recoverableFinalBoss(id));
if (unknown.length) throw new Error(`No known final boss for map(s) ${unknown.join(", ")}`);

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

try {
  const guildIds = only ? [only] : (await prisma.dungeonRun.findMany({ where: { instanceId: { in: INSTANCE_IDS }, state: { not: "COMPLETED" } }, distinct: ["guildId"], select: { guildId: true } })).map((row) => row.guildId);
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${guildIds.length} server(s) with runs of map(s) ${INSTANCE_IDS.join(", ")} that are not completed`);
  let changed = 0;
  for (const guildId of guildIds) {
    const rows = await prisma.dungeonRun.findMany({
      where: { guildId, instanceId: { in: INSTANCE_IDS }, state: { not: "COMPLETED" } }, orderBy: { startedAt: "asc" }, take: 200,
      select: { id: true, runRef: true, instanceId: true, state: true, startedAt: true, endedAt: true, durationSec: true, importId: true, competitionData: true }
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
        const ratingRun = { instanceId: row.instanceId, difficultyId: parsed.data.difficultyId, durationSec: seconds, startedAt: began ? new Date(began * 1000) : null, endedAt: new Date(completed.endedAt * 1000),
          createdAt: new Date(), completedBy: "final boss", runRef: row.runRef,
          competitionData: { integrity: parsed.data.integrity, players: parsed.data.players.map((p) => ({ name: p.character, level: p.level ?? null, minLevel: p.minLevel ?? null, integrity: p.integrity })), encounters: parsed.data.encounters ?? [] },
          players: parsed.data.players.map((p) => ({ character: p.character, memberId: null, presentSec: p.presentSec, member: null })) };
        const verdict = bracketedVerdict(ratingRun, rules);
        for (const p of parsed.data.players) {
          const present = presentEnough(p.presentSec, seconds);
          const observed = rules.evidencePolicy !== "current-v2" || integrityPresence(p.integrity, seconds, began);
          const points = verdict.reason ? `no points (${verdict.reason})` : !present ? "no points (presence under 80%)" : !observed ? "no points (known in-instance presence under 80%)" : `${penalized(timeRating(seconds, verdict.targetSec), verdict.penaltyPercent)} points`;
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
        const result = await importDungeonRuns(tx, guildId, [run], characters, "rescore-runs", row.importId);
        // Keep the original ABANDONED report next to the completed one, only when the import really upgraded the run.
        if (result.results.length > 0) {
          const stored = await tx.dungeonRun.findUnique({ where: { id: row.id }, select: { competitionData: true } });
          const data = isRecord(stored?.competitionData) ? stored.competitionData : {};
          const recovery = { at: new Date().toISOString(), by: "rescore-runs", oldState: row.state, oldEndedAt: row.endedAt?.toISOString() ?? null, oldDurationSec: row.durationSec, newEndedAt: iso(endedAt), droppedEncounters: dropped, originalReport: raw };
          await tx.dungeonRun.update({ where: { id: row.id }, data: { competitionData: { ...data, recovery } as unknown as Prisma.InputJsonValue } });
        }
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
