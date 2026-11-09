// Owner-run backfill for WoW Forever full names (8.5, docs/FOREVER_NAMES.md). Before 8.5 the addon
// sent only a Forever character's first name; this renames each first-name row to the full
// "First Last" its own display name already carries, when no other character of the guild shares
// that first name. Rows that share a first name are listed for an officer and left as they are.
//
//   npm run names:forever                          (preview, every guild)
//   npm run names:forever -- --guild <discord id>  (preview, one server)
//   npm run names:forever -- --apply               (renames; take a database backup first)
//
// Preview by default: nothing is changed without --apply. Nothing is ever deleted or merged; the
// old name stays in legacyName. (Only duplicate race to 60 rows are merged, see applyRaceKeyMerges.)
import { createPrismaClient } from "../src/database.js";
import { applyForeverNames, applyRaceKeyMerges, describePlan, planForeverNames, planRaceKeyMerges } from "../src/services/forever-names.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const guildIndex = args.indexOf("--guild");
const discordId = guildIndex >= 0 ? args[guildIndex + 1] : undefined;
if (guildIndex >= 0 && !discordId) throw new Error("--guild needs a Discord server id.");

const db = createPrismaClient();
try {
  const guilds = await db.guild.findMany({ where: discordId ? { discordId } : {}, select: { id: true, name: true } });
  if (discordId && !guilds.length) throw new Error("No guild is linked to that Discord server id.");
  const ids = guilds.map((g) => g.id);
  const characters = await db.character.findMany({ where: { guildId: { in: ids }, gameEdition: "forever" }, select: { id: true, guildId: true, name: true, displayName: true } });
  const unclaimed = await db.unclaimedCharacter.findMany({ where: { guildId: { in: ids }, gameEdition: "forever" }, select: { id: true, guildId: true, name: true, displayName: true } });
  const plan = planForeverNames(characters, unclaimed);
  for (const line of describePlan(plan, new Map(guilds.map((g) => [g.id, g.name])))) console.log(line);
  // Race to 60: merge first-name LevelRaceEntry / RaceHallEntry rows into their full-name row.
  const fullNames = new Map<string, string>();
  for (const row of [...characters, ...unclaimed]) if (row.name.trim().includes(" ")) fullNames.set(`${row.guildId}\n${row.name.trim().replace(/\s+/g, " ").toLowerCase()}`, row.name.trim());
  const levelRows = await db.levelRaceEntry.findMany({ where: { guildId: { in: ids } } });
  const hallRows = await db.raceHallEntry.findMany({ where: { guildId: { in: ids } } });
  const raceMerges = [...planRaceKeyMerges("level", levelRows, fullNames), ...planRaceKeyMerges("hall", hallRows, fullNames).filter((merge) => merge.toId === null)];
  for (const merge of raceMerges) console.log(`  race ${merge.store === "level" ? "board entry" : "Hall of Fame entry"} -> ${merge.toName}${merge.toId ? " (merge duplicate)" : " (move key)"}`);
  if (!apply) {
    console.log(`Race to 60: ${raceMerges.length} stored row(s) would be merged or moved.`);
    console.log(`Preview only: ${plan.renames.length} rename(s), ${plan.review.length} row(s) to review. Nothing was changed. Add --apply after a database backup.`);
  } else {
    const result = await db.$transaction((tx) => applyForeverNames(tx, plan.renames), { timeout: 120_000, maxWait: 15_000 });
    console.log(`Renamed ${result.renamed} row(s); moved ${result.keysMoved} key(s); kept ${result.keysKept} key(s) whose full-name key already existed.`);
    const race = await db.$transaction((tx) => applyRaceKeyMerges(tx, raceMerges), { timeout: 120_000, maxWait: 15_000 });
    console.log(`Race to 60: merged ${race.merged} duplicate row(s); moved ${race.moved} key(s). Duplicate Hall of Fame entries are left for the bot, which removes the later number and its post on its next refresh.`);
  }
} finally { await db.$disconnect(); }
