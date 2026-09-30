import type { PrismaClient } from "@prisma/client";
export async function coreContext(database: Pick<PrismaClient, "raidCore">, guildId: string, channelId: string, value?: string | null) {
  if (value) {
    const core = await database.raidCore.findFirst({ where: { guildId, OR: [{ id: value }, { name: { equals: value, mode: "insensitive" } }] } });
    if (!core) throw new Error("That raid core does not belong to this guild.");
    return core;
  }
  return database.raidCore.findFirst({ where: { guildId, OR: [{ signupChannelId: channelId }, { lootChannelId: channelId }, { raidLogChannelId: channelId }, { chatChannelId: channelId }, { rosterChannelId: channelId }] } });
}
