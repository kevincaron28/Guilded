import type { Guild as DiscordGuild, Message } from "discord.js";
import { prisma } from "../database.js";
import { guildWhere } from "./guild-scope.js";

// The standalone "Who's who" board post was retired in 9.0.2 (owner decision, 7 November 2026): mains and alts stay on the
// roster card, /character profile and the guild page. The bot no longer creates or edits the post. What is left here is the
// clean-up: /setup offers to delete the message an older version posted, after an officer confirms.

export const WHOS_WHO_MARKER = "Guilded who's who";

const isBoard = (message: Message, botId: string) => message.author.id === botId && message.embeds.some((embed) => embed.footer?.text?.startsWith(`${WHOS_WHO_MARKER} •`));

/** Whether this server still has the old board post to offer to delete (a saved message id). */
export const hasWhosWhoPost = (settings: { whosWhoMessageId?: string | null } | null | undefined): boolean => Boolean(settings?.whosWhoMessageId);

/**
 * Deletes the old board message (the saved one, or a bot board found in its channel) and forgets it, so /setup stops offering.
 * Only ever deletes a message the bot itself posted with the board's marker. Never throws.
 */
export async function deleteWhosWhoPost(discordGuild: DiscordGuild): Promise<{ ok: boolean; message: string }> {
  try {
    const guild = await prisma.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true, settings: true } });
    const settings = guild?.settings;
    if (!guild || !settings) return { ok: false, message: "no settings" };
    const forget = () => prisma.guildSettings.update({ where: { guildId: guild.id }, data: { whosWhoMessageId: null, whosWhoChannelId: null, whosWhoEnabled: false } });
    const channelId = settings.whosWhoChannelId ?? settings.guideChannelId;
    const channel = channelId ? await discordGuild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased() || !("messages" in channel)) { await forget(); return { ok: true, message: "channel gone" }; }
    const botId = discordGuild.client.user?.id ?? "";
    let target: Message | null = settings.whosWhoMessageId ? await channel.messages.fetch(settings.whosWhoMessageId).catch(() => null) : null;
    if (target && !isBoard(target, botId)) target = null;
    if (!target) target = (await channel.messages.fetch({ limit: 50 }).catch(() => null))?.find((message) => isBoard(message, botId)) ?? null;
    if (target) {
      if (!target.deletable) return { ok: false, message: "I cannot delete that message (check my Manage Messages permission)." };
      await target.delete();
    }
    await forget();
    return { ok: true, message: target ? "deleted" : "already gone" };
  } catch (error) {
    console.error("Failed to delete the who's who post", error);
    return { ok: false, message: "unexpected error" };
  }
}
