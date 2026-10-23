import { pilotGuildScope } from "../hosted-pilot.js";
import type { Client } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { asLang, t } from "../i18n.js";

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
    // Mark first so a Discord hiccup can never cause repeated pings.
    await database.raid.update({ where: { id: raid.id }, data: { reminderSentAt: now } });
    const channelId = raid.signupChannelId ?? settings?.raidSignupChannelId;
    if (!channelId || raid.signups.length === 0) continue;
    try {
      const discordGuild = await client.guilds.fetch(raid.guild.discordId);
      const channel = await discordGuild.channels.fetch(channelId);
      if (!channel?.isTextBased()) continue;
      const userIds = raid.signups.map((signup) => signup.member.discordUserId);
      await channel.send({
        content: t(asLang(settings?.language), "reminder", {
          raid: raid.title,
          when: `<t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:R>`,
          mentions: userIds.map((id) => `<@${id}>`).join(" ")
        }).slice(0, 1900),
        allowedMentions: { users: userIds.slice(0, 100) }
      });
      sent += 1;
    } catch (error) {
      console.error(`Raid reminder failed for raid ${raid.id}`, error);
    }
  }
  return sent;
}
