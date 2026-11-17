// One-off repair (17 November 2026): a dungeon run carried by an addon-only player's carrier had boss ids but no boss names, so on a map that
// holds several routes (Scarlet Monastery's four wings) the public lane could not tell the route ("Dungeon route unknown", the player did not
// rank). The bot now names the bosses from their ids when it unpacks a carried record (carried-runs.ts); this script repairs the runs stored
// before that: it names each kill from the bot's boss lists (dungeon-bosses.ts) and sets the route (publicRouteKey) of public runs on such a map
// that have no route. Nothing else is changed; scores are computed when read, so boards follow. Posts nothing, starts no bot session.
//   npx tsx scripts/backfill-carried-routes.ts            dry run: lists what would change
//   npx tsx scripts/backfill-carried-routes.ts --apply    writes it
import { createPrismaClient } from "../src/database.js";
import { routesOfInstance, ROUTE_BOSSES } from "../src/services/dungeon-bosses.js";
import { publicRouteKey } from "../src/services/public-score.js";

const apply = process.argv.includes("--apply");
const multiRouteMaps = [...new Set(ROUTE_BOSSES.filter((route) => ROUTE_BOSSES.filter((other) => other.instanceId === route.instanceId).length > 1).map((route) => route.instanceId))];
const prisma = createPrismaClient();
try {
  const rows = await prisma.publicRun.findMany({ where: { instanceId: { in: multiRouteMaps }, routeKey: null }, select: { id: true, runKey: true, instanceId: true, encounters: true } });
  let changed = 0, stillUnknown = 0;
  for (const row of rows) {
    const known = routesOfInstance(row.instanceId).flatMap((route) => route.bosses);
    const encounters = (Array.isArray(row.encounters) ? row.encounters : []) as { id?: number; name?: string; success?: boolean }[];
    const named = encounters.map((boss) => {
      if (!boss || boss.name || typeof boss.id !== "number") return boss;
      const name = known.find((entry) => entry.ids.includes(boss.id!))?.name;
      return name ? { ...boss, name } : boss;
    });
    const routeKey = publicRouteKey(row.instanceId, named.filter((boss): boss is { id?: number; name?: string; success: boolean } => !!boss && typeof boss.success === "boolean"));
    if (!routeKey || routeKey === String(row.instanceId)) { stillUnknown++; continue; }
    changed++;
    console.log(`${apply ? "fixed" : "would fix"} ${row.runKey.slice(0, 60)} -> ${routeKey}`);
    if (apply) await prisma.publicRun.update({ where: { id: row.id }, data: { routeKey, encounters: named as never } });
  }
  console.log(`${rows.length} run(s) on multi-route maps without a route: ${changed} ${apply ? "repaired" : "can be repaired"}, ${stillUnknown} stay unknown (no boss that tells the route).`);
} finally { await prisma.$disconnect(); }
