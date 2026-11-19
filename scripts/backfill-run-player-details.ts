// One-off repair (owner request, 19 November 2026): public runs whose merge dropped each player's guild, faction, display name and
// deaths (a guildmate's relayed copy replaced the recorder's report). Restores them from the uploads' own saved evidence.
// Fills only NULL fields of PublicRunPlayer. Reads and writes the database in DATABASE_URL: run it only with the owner's yes.
//   npx tsx scripts/backfill-run-player-details.ts                          dry run: counts what would change
//   npx tsx scripts/backfill-run-player-details.ts --run "QG-20261119-192451-Lebowski Holyroller"   one run (dry)
//   npx tsx scripts/backfill-run-player-details.ts --apply [--run REF]      writes
// The Discord dungeon cards read DungeonRunPlayer.guild, which the same merge could blank; this script does not touch it, a card
// already posted is not redrawn, and new cards fall back to the in-game guild name (import-followup.ownGuildNames).
import { createPrismaClient } from "../src/database.js";
import { restorePlayerPatches } from "../src/services/public-run-player-restore.js";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const apply = process.argv.includes("--apply");
const only = arg("--run");
const prisma = createPrismaClient();
let runs = 0, patched = 0;
try {
  for (let cursor: string | undefined; ;) {
    const page = await prisma.publicRun.findMany({
      where: { ...(only ? { runRef: only } : {}), players: { some: { OR: [{ guild: null }, { faction: null }, { displayName: null }, { deaths: null }] } } },
      select: { id: true, players: { select: { id: true, character: true, realm: true, guild: true, faction: true, displayName: true, deaths: true } }, uploads: { select: { evidence: true } } },
      orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!page.length) break;
    for (const run of page) {
      runs++;
      for (const { id, ...data } of restorePlayerPatches(run.players, run.uploads.map((upload) => upload.evidence as never))) {
        patched++;
        if (apply) await prisma.publicRunPlayer.update({ where: { id }, data });
      }
    }
    cursor = page[page.length - 1]!.id;
  }
  console.log(`${apply ? "Updated" : "Would update"} ${patched} player rows across ${runs} public runs scanned.`);
} finally { await prisma.$disconnect(); }
