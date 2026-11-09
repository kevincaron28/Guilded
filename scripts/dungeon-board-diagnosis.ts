// Read-only: for every guild, how many stored dungeon runs reach the season board and the first reason each other run does not.
// Writes nothing, prints no credentials or Discord ids. Run on the server (it has the database settings):
//   npx tsx scripts/dungeon-board-diagnosis.ts [--json]
// Output per guild: "<name>: season <S>, N run(s) received, M on the board." then "  count × reason" lines, most common first.
import { prisma } from "../src/database.js";
import { boardDiagnosisReport, diagnoseDungeonBoard } from "../src/services/dungeon-board-diagnosis.js";

try {
  const guilds = await prisma.guild.findMany({ where: { isTestServer: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const out: unknown[] = [];
  for (const guild of guilds) {
    const diagnosis = await diagnoseDungeonBoard(prisma, guild.id);
    if (!diagnosis.received && !diagnosis.season) continue;
    if (process.argv.includes("--json")) out.push({ guild: guild.name, ...diagnosis }); else console.log(boardDiagnosisReport(guild.name, diagnosis));
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
} catch {
  console.error("Dungeon board diagnosis unavailable (no database access?). Nothing was changed.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
