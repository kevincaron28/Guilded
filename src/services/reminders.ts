import { pilotGuildScope } from "../hosted-pilot.js";
import { EmbedBuilder, type Client, type Guild } from "discord.js";
import type { DiscordJob, PrismaClient } from "../generated/prisma/client.js";
import { asLang, t } from "../i18n.js";
import { deliverDiscordJob } from "./discord-jobs.js";

// Due once the raid is within `minutes` of starting, until it starts, and
// only if no reminder was sent yet.
export function isReminderDue(input: { now: Date; scheduledAt: Date; minutes: number; sentAt: Date | null }): boolean {
  if (input.sentAt || input.minutes <= 0) return false;
  const untilStart = input.scheduledAt.getTime() - input.now.getTime();
  return untilStart > 0 && untilStart <= input.minutes * 60_000;
}

// Called on a timer from main.ts: pings everyone signed up (not maybe or
// waitlisted) in the raid's signup channel, once per raid. A raid whose
// window passed while the bot was offline simply gets no reminder.
export async function runRaidReminders(client: Client, database: PrismaClient, now = new Date()): Promise<number> {
  const raids = await database.raid.findMany({
    where: { ...pilotGuildScope, status: "PLANNED", reminderSentAt: null, scheduledAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) } },
    include: {
      guild: { include: { settings: true } },
      signups: { where: { status: "SIGNED_UP" }, include: { member: true } }
    }
  });
  let sent = 0;
  for (const raid of raids) {
    const settings = raid.guild.settings;
    const minutes = settings?.raidReminderMinutes ?? 60;
    if (!isReminderDue({ now, scheduledAt: raid.scheduledAt, minutes, sentAt: raid.reminderSentAt })) continue;
    const channelId = raid.signupChannelId ?? settings?.raidSignupChannelId;
    if (!channelId || raid.signups.length === 0) continue;
    try {
      const key = `raid-reminder:${raid.id}:${raid.scheduledAt.toISOString()}`;
      const job = await database.discordJob.upsert({ where: { guildId_key: { guildId: raid.guildId, key } },
        create: { guildId: raid.guildId, key, kind: "RAID_REMINDER", payload: { raidId: raid.id, scheduledAt: raid.scheduledAt.toISOString() } }, update: {} });
      const discordGuild = await client.guilds.fetch(raid.guild.discordId);
      await deliverDiscordJob(database, job.id, current => deliverRaidReminder(discordGuild, database, current, now), now);
      if ((await database.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE") sent += 1;
    } catch (error) {
      console.error(`Raid reminder failed for raid ${raid.id}`, error);
    }
  }
  return sent;
}

export async function deliverRaidReminder(guild: Guild, database: PrismaClient, job: DiscordJob, now = new Date()): Promise<void> {
  const payload = job.payload as { raidId?: string; scheduledAt?: string };
  const raid = await database.raid.findFirst({ where: { id: payload.raidId ?? "", guildId: job.guildId },
    include: { guild: { include: { settings: true } }, signups: { where: { status: "SIGNED_UP" }, include: { member: true } } } });
  if (!raid || raid.status !== "PLANNED" || raid.guild.discordId !== guild.id || raid.scheduledAt.toISOString() !== payload.scheduledAt) return;
  const settings = raid.guild.settings;
  if (!isReminderDue({ now, scheduledAt: raid.scheduledAt, minutes: settings?.raidReminderMinutes ?? 60, sentAt: raid.reminderSentAt })) return;
  const channelId = raid.signupChannelId ?? settings?.raidSignupChannelId;
  if (!channelId || !raid.signups.length) return;
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error("Reminder channel unavailable");
  const marker = `Guilded reminder ${job.id}`;
  const recent = await channel.messages.fetch({ limit: 100 });
  const delivered = recent.some(message => message.author.id === guild.client.user?.id && message.embeds.some(embed => embed.footer?.text === marker));
  if (!delivered) {
    const userIds = raid.signups.map(signup => signup.member.discordUserId).slice(0, 100);
    await channel.send({ content: t(asLang(settings?.language), "reminder", { raid: raid.title,
      when: `<t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:R>`, mentions: userIds.map(id => `<@${id}>`).join(" ") }).slice(0, 1900),
      embeds: [new EmbedBuilder().setFooter({ text: marker })],
      allowedMentions: { parse: [], users: userIds }, nonce: job.id.slice(-25), enforceNonce: true });
  }
  await database.raid.update({ where: { id: raid.id }, data: { reminderSentAt: now } });
}
