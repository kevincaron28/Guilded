// Owner-run cleanup of WoW Forever beta / pre-launch data (docs/PRELAUNCH_CLEANUP.md).
//
//   npm run cleanup:prelaunch                          (preview, every guild)
//   npm run cleanup:prelaunch -- --guild <discord id>  (preview, one server)
//   npm run cleanup:prelaunch -- --apply               (deletes; take a database backup first)
//
// Preview by default: nothing is deleted without --apply. With --apply each guild is cleaned in
// one transaction and the live bot redraws the profession directory and posts, the race board and
// the dungeon board through its job queue. Running it again finds nothing more to delete.
// The rule is at the top of src/services/prelaunch-cleanup.ts. EP/GP and Season 1 are never touched.
import { createPrismaClient } from "../src/database.js";
import { applyPrelaunchCleanup, describeCleanup, FOREVER_LAUNCH, loadCleanupInput, planPrelaunchCleanup } from "../src/services/prelaunch-cleanup.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const guildIndex = args.indexOf("--guild");
const discordId = guildIndex >= 0 ? args[guildIndex + 1] : undefined;
if (guildIndex >= 0 && !discordId) throw new Error("--guild needs a Discord server id.");

const db = createPrismaClient();
try {
  const guilds = await db.guild.findMany({ where: discordId ? { discordId } : {}, select: { id: true, name: true } });
  if (discordId && !guilds.length) throw new Error("No guild is linked to that Discord server id.");
  console.log(`Rule: WoW Forever data whose last activity is before ${FOREVER_LAUNCH.toISOString()} (launch), the beta dungeon season and seasons that ended before launch. EP/GP and Season 1 are never touched.`);
  let total = 0;
  for (const guild of guilds) {
    const plan = planPrelaunchCleanup(await loadCleanupInput(db, guild.id));
    const size = plan.characters.length + plan.unclaimed.length + plan.recipeIds.length + plan.cooldownIds.length
      + plan.levelRaceIds.length + plan.raceHallIds.length + plan.seasons.length + plan.runIds.length;
    if (!size && !plan.ambiguous.length) continue;
    total += size;
    const counted = plan.characters.length ? await db.character.findMany({ where: { id: { in: plan.characters.map((c) => c.id) } },
      select: { _count: { select: { professions: true, attunements: true, wishlist: true, readinessSnapshots: true, raidSignups: true, coreSpots: true, coreBackups: true } } } }) : [];
    const dependents: Record<string, number> = {};
    for (const row of counted) for (const [k, n] of Object.entries(row._count)) dependents[k] = (dependents[k] ?? 0) + n;
    for (const line of describeCleanup(guild.name, plan, dependents)) console.log(line);
    const posted = await db.raceHallEntry.findMany({ where: { id: { in: plan.raceHallIds }, posted: true }, select: { name: true } });
    if (posted.length) console.log(`  hall of fame posts already in Discord (delete by hand): ${posted.map((p) => p.name).join(", ")}`);
    if (apply && size) {
      const counts = await db.$transaction((tx) => applyPrelaunchCleanup(tx, guild.id, plan), { timeout: 120_000, maxWait: 15_000 });
      console.log(`  DELETED: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}`);
    }
  }
  if (!total) console.log("Nothing from before the WoW Forever launch is left to delete.");
  else if (!apply) console.log("Preview only. Nothing was deleted. Add --apply after a database backup.");
} finally { await db.$disconnect(); }
