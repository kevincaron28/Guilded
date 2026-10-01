import type { PrismaClient } from "@prisma/client";
import { enqueueDiscordJob } from "./discord-jobs.js";

type Db = Pick<PrismaClient, "guildSettings" | "character" | "raidCore" | "raid" | "discordJob">;

// Opt-in character signups: refresh affected characters, or all active displays hourly.
export async function queueCharacterDisplayRefresh(database: Db, guildId: string, characterIds?: string[]) {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { characterSignups: true } });
  if (!settings?.characterSignups || characterIds?.length === 0) return [];
  let ids: string[] | undefined;
  if (characterIds) {
    ids = (await database.character.findMany({ where: { id: { in: characterIds }, member: { guildId } }, select: { id: true } })).map(character => character.id);
    if (!ids.length) return [];
  }
  const cores = await database.raidCore.findMany({ where: { guildId, ...(ids ? { members: { some: { OR: [
    { characterId: { in: ids } }, { backups: { some: { characterId: { in: ids } } } }
  ] } } } : {}) }, select: { id: true } });
  const raids = await database.raid.findMany({ where: { guildId, status: { in: ["PLANNED", "ACTIVE"] }, ...(ids ? { OR: [
    { signups: { some: { characterId: { in: ids } } } }, { coreId: { in: cores.map(core => core.id) } }
  ] } : {}) }, select: { id: true } });
  const jobs = [];
  for (const core of cores) jobs.push(await enqueueDiscordJob(database, guildId, `core-roster:${core.id}`, "CORE_ROSTER", { coreId: core.id }));
  for (const raid of raids) jobs.push(await enqueueDiscordJob(database, guildId, `raid:${raid.id}`, "RAID_POST", { raidId: raid.id }));
  return jobs;
}
