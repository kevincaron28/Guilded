import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";

// Once per trial, the core's officer log is told that a trial period has ended, so officers approve
// or reject the member. Nothing changes on its own: the decision stays with the officers.
export interface EndedTrial { guildId: string; discordGuildId: string; core: string; member: string; startedAt: Date | null; sponsorId: string | null }
export type TrialDelivery = (trial: EndedTrial, text: string) => Promise<"sent" | "no-channel" | "unreachable">;

export function trialEndedText(trial: EndedTrial): string {
  const details = [
    ...(trial.startedAt ? [`since <t:${Math.floor(trial.startedAt.getTime() / 1000)}:D>`] : []),
    ...(trial.sponsorId ? [`sponsor <@${trial.sponsorId}>`] : [])
  ];
  return `⏳ Trial ended: **${trial.member}** in **${trial.core}**${details.length ? ` (${details.join(", ")})` : ""}. `
    + "Approve or reject them on their application card, or with /mod application approve|reject.";
}

type Db = Pick<PrismaClient, "raidCoreMember">;

export async function remindEndedTrials(database: Db, deliver: TrialDelivery, now = new Date()): Promise<number> {
  const due = await database.raidCoreMember.findMany({
    where: { trial: true, trialEndsAt: { lte: now }, trialRemindedAt: null, member: { status: "ACTIVE", isTest: false } },
    orderBy: { trialEndsAt: "asc" }, take: 50,
    select: { id: true, trialStartedAt: true, trialSponsorId: true, member: { select: { displayName: true } }, core: { select: { name: true, guild: { select: { id: true, discordId: true } } } } }
  });
  let sent = 0;
  for (const spot of due) {
    const trial = { guildId: spot.core.guild.id, discordGuildId: spot.core.guild.discordId, core: spot.core.name, member: spot.member.displayName, startedAt: spot.trialStartedAt, sponsorId: spot.trialSponsorId };
    const result = await deliver(trial, trialEndedText(trial));
    // A server the bot can't reach now is retried next hour; without an officer log there is nothing to retry.
    if (result === "unreachable") continue;
    await database.raidCoreMember.update({ where: { id: spot.id }, data: { trialRemindedAt: now } });
    if (result === "sent") sent++;
  }
  return sent;
}

export function discordTrialDelivery(client: Client, database: Pick<PrismaClient, "guildSettings">, allows: (discordId: string) => boolean): TrialDelivery {
  return async (trial, text) => {
    const discordGuild = allows(trial.discordGuildId) ? client.guilds.cache.get(trial.discordGuildId) : undefined;
    if (!discordGuild) return "unreachable";
    const settings = await database.guildSettings.findUnique({ where: { guildId: trial.guildId }, select: { logChannelId: true } });
    const channel = settings?.logChannelId ? await discordGuild.channels.fetch(settings.logChannelId).catch(() => null) : null;
    if (!channel?.isSendable()) return "no-channel";
    await channel.send({ content: text, allowedMentions: { parse: [] } });
    return "sent";
  };
}
