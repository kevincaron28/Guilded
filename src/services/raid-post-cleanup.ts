import { pilotGuildScope } from "../hosted-pilot.js";
import type { Client } from "discord.js";
import type { Prisma, PrismaClient } from "@prisma/client";

// Signup posts of raids that are over are removed a day later, so the signup channels only show
// what is coming. The raid, its signups, attendance and report stay in the database.
export const PAST_RAID_POST_MS = 24 * 60 * 60_000;
// A raid nobody started or ended counts as over six hours after its start time.
export const UNENDED_RAID_MS = 6 * 60 * 60_000;

// A planned raid this old is over: its signup post is removed and never posted again.
export const stalePlannedBefore = (now: Date) => new Date(now.getTime() - UNENDED_RAID_MS - PAST_RAID_POST_MS);

export function pastRaidPostWhere(now: Date): Prisma.RaidWhereInput {
  const day = new Date(now.getTime() - PAST_RAID_POST_MS);
  return {
    AND: [
      { OR: [{ signupMessageId: { not: null } }, { mirrorSignupMessageId: { not: null } }] },
      { OR: [
        { status: "COMPLETED", endedAt: { lte: day } },
        { status: "CANCELLED", updatedAt: { lte: day } },
        { status: "PLANNED", scheduledAt: { lte: stalePlannedBefore(now) } },
        // A forgotten /raid end must not leave signup channels cluttered forever.
        { status: "ACTIVE", OR: [
          { startedAt: { lte: stalePlannedBefore(now) } },
          { startedAt: null, scheduledAt: { lte: stalePlannedBefore(now) } }
        ] }
      ] }
    ]
  };
}

// Discord's "Unknown Message" / "Unknown Channel": the post is already gone.
const alreadyGone = (error: unknown) => [10003, 10008].includes((error as { code?: number }).code ?? 0);

export async function cleanupPastRaidPosts(client: Client, database: PrismaClient, now = new Date()): Promise<number> {
  if (!client.user) return 0;
  const raids = await database.raid.findMany({ where: { ...pastRaidPostWhere(now), ...pilotGuildScope }, take: 50, orderBy: { scheduledAt: "asc" }, include: { guild: { select: { discordId: true } } } });
  let removed = 0;
  for (const raid of raids) {
    const guild = client.guilds.cache.get(raid.guild.discordId);
    if (!guild) continue;
    const data: { signupMessageId?: null; mirrorSignupMessageId?: null } = {};
    for (const [channelId, messageId, field] of [[raid.signupChannelId, raid.signupMessageId, "signupMessageId"], [raid.mirrorSignupChannelId, raid.mirrorSignupMessageId, "mirrorSignupMessageId"]] as const) {
      if (!messageId) continue;
      try {
        const channel = channelId ? await guild.channels.fetch(channelId) : null;
        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(messageId);
          if (message.author.id !== client.user.id || message.pinned) continue;
          await message.delete();
        }
        data[field] = null;
      } catch (error) {
        // Gone already: forget it. Anything else (a missing permission) is tried again later.
        if (alreadyGone(error)) data[field] = null;
        else console.warn(`Could not remove the signup post of raid ${raid.id}`, error);
      }
    }
    if (Object.keys(data).length) { await database.raid.update({ where: { id: raid.id }, data }); removed++; }
  }
  return removed;
}
