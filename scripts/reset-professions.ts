// Owner-run cleanup for the Discord profession directory ("Guild profession directory" post,
// /craft who, /character profession who). Those read every stored ProfessionSkill row of the
// guild's active members, so skills recorded before a fresh start (for example WoW Forever's beta)
// keep showing until the rows are removed.
//
//   npm run professions:reset -- --guild <discord server id> --before 2026-11-04T23:00:00Z
//   npm run professions:reset -- --guild <id> --before <iso> --realm "Classic Beta PvP"   (narrower)
//   npm run professions:reset -- --guild <id> --before <iso> --apply                      (deletes)
//
// Preview by default: nothing is changed without --apply. Rows whose updatedAt is before --before
// (and, with --realm, only characters on that realm) are selected. Take a database backup first
// (docs/DEPLOY_ORACLE.md). Characters, links, ledger and everything else stay. The directory post
// is rebuilt the next time it refreshes after an addon import.
import { createPrismaClient } from "../src/database.js";
import { parseResetArgs, selectSkillsToRemove, type SkillRow } from "../src/services/profession-reset.js";

const { guild, before, realm, apply } = parseResetArgs(process.argv.slice(2));
const db = createPrismaClient();
try {
  const guilds = await db.guild.findMany({ where: { discordId: guild }, select: { id: true } });
  if (guilds.length === 0) throw new Error("No in-game guild is linked to that Discord server id.");
  const rows = await db.professionSkill.findMany({
    where: { character: { member: { guildId: { in: guilds.map((g) => g.id) } } } },
    include: { character: { select: { name: true, realm: true } } }
  });
  const all: SkillRow[] = rows.map((row) => ({ id: row.id, profession: row.profession, updatedAt: row.updatedAt, character: row.character.name, realm: row.character.realm }));
  const remove = selectSkillsToRemove(all, before, realm);
  console.log(`${all.length} profession rows in total; ${remove.length} older than ${before.toISOString()}${realm ? ` on realm "${realm}"` : ""}; ${all.length - remove.length} would stay.`);
  const byCharacter = new Map<string, number>();
  for (const row of remove) { const key = `${row.character} (${row.realm})`; byCharacter.set(key, (byCharacter.get(key) ?? 0) + 1); }
  for (const [name, count] of [...byCharacter].sort()) console.log(`  ${name}: ${count}`);
  if (!apply) console.log("Preview only. Nothing was changed. Add --apply after a database backup to delete these rows.");
  else console.log(`Deleted ${(await db.professionSkill.deleteMany({ where: { id: { in: remove.map((row) => row.id) } } })).count} profession rows.`);
} finally { await db.$disconnect(); }
