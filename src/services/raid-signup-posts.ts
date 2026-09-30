import type { Guild, MessageCreateOptions } from "discord.js";
import type { PrismaClient, Raid } from "@prisma/client";

type References = Pick<Raid, "id" | "guildId" | "signupChannelId" | "signupMessageId" | "mirrorSignupChannelId" | "mirrorSignupMessageId">;
const pending = new Map<string, Promise<void>>();
export async function serializeRaidPosts(key: string, work: () => Promise<void>): Promise<void> {
  const task = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  pending.set(key, task);
  try { await task; } finally { if (pending.get(key) === task) pending.delete(key); }
}

// Both messages carry the same raid id; the signup table remains the sole roster.
export async function syncRaidPosts(guild: Guild, database: Pick<PrismaClient, "raid">, raid: References,
  generalChannelId: string | null, coreChannelId: string | null, payload: Pick<MessageCreateOptions, "embeds" | "components" | "allowedMentions">): Promise<void> {
  const targets = [...new Set([generalChannelId, coreChannelId].filter((id): id is string => !!id))];
  if (!targets.length) throw new Error("Configure a raid signups channel in setup first.");
  const references = new Map<string, string>();
  if (raid.signupChannelId && raid.signupMessageId) references.set(raid.signupChannelId, raid.signupMessageId);
  if (raid.mirrorSignupChannelId && raid.mirrorSignupMessageId) references.set(raid.mirrorSignupChannelId, raid.mirrorSignupMessageId);
  for (const [index, channelId] of targets.entries()) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error("The raid signups channel is unavailable.");
    const messageId = references.get(channelId);
    let message = messageId ? await channel.messages.fetch(messageId).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === 10008) return null;
      throw error;
    }) : null;
    if (message) await message.edit(payload);
    else message = await channel.send(payload);
    await database.raid.updateMany({ where: { id: raid.id, guildId: raid.guildId }, data: index === 0
      ? { signupChannelId: channelId, signupMessageId: message.id,
          ...(targets[1] && references.has(targets[1]) ? { mirrorSignupChannelId: targets[1], mirrorSignupMessageId: references.get(targets[1])! } : {}) }
      : { mirrorSignupChannelId: channelId, mirrorSignupMessageId: message.id } });
  }
}
