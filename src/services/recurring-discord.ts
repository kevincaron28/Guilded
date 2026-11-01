import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, escapeMarkdown, PermissionFlagsBits, type Client, type Guild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import { hasPermission } from "../permissions.js";
import { currentGuildScope, withGuildScope } from "./guild-scope.js";
import { recurringDue, recurringScheduleSchema, deliverRecurringRecap } from "./recurring-delivery.js";
import { actOnWeeklyQuestion, reviewWeeklyQuestion } from "./weekly-question-store.js";
import { personalWeeklyRecap, personalWeeklyRecapEmbed } from "./personal-weekly-recap.js";

export async function automationChannelAccess(guild: Guild, userId: string, channelId: string) {
  const [actor, bot, channel] = await Promise.all([guild.members.fetch({ user: userId, force: true }).catch(() => null), guild.members.fetchMe({ force: true }).catch(() => null), guild.channels.fetch(channelId).catch(() => null)]);
  return !!actor && hasPermission(actor, "officer") && !!bot && channel?.type === ChannelType.GuildText
    && channel.permissionsFor(actor).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    && channel.permissionsFor(bot).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
}

export async function runRecurringDeliveries(client: Client, db: PrismaClient, now = new Date()) {
  const began = Date.now();
  const deliveryTime = () => new Date(now.getTime() + Math.max(0, Date.now() - began));
  const guilds = await db.guildSettings.findMany({ where: pilotGuildScope, include: { guild: true } });
  for (const setting of guilds) await withGuildScope(db, setting.guildId, async () => {
    const guild = client.guilds.cache.get(setting.guild.discordId);
    if (!guild) return;
    const plan = await db.weeklyQuestionPlan.findUnique({ where: { guildId: setting.guildId } });
    const schedule = recurringScheduleSchema.safeParse(plan?.automation);
    if (plan && !plan.paused && schedule.success && recurringDue(schedule.data, now)) {
      const review = await reviewWeeklyQuestion(db, setting.guildId, plan.createdBy, now);
      await actOnWeeklyQuestion(db, { guildId: setting.guildId, actorId: plan.createdBy, reviewId: review.review.id, action: "post",
        authorize: async channelId => {
          const current = await db.weeklyQuestionPlan.findUnique({ where: { guildId: setting.guildId } });
          return !!current?.automation && !current.paused && current.revision === plan.revision && await automationChannelAccess(guild, plan.createdBy, channelId) && recurringDue(schedule.data, deliveryTime());
        },
        send: async (settings, pollId) => {
          const channel = await guild.channels.fetch(settings.channelId);
          if (channel?.type !== ChannelType.GuildText) throw new Error("Channel unavailable");
          const fr = setting.language === "fr";
          const message = await channel.send({ embeds: [new EmbedBuilder().setTitle(fr ? "Question de la semaine" : "Question of the week")
            .setDescription([escapeMarkdown(settings.question), ...settings.options.map((text, index) => `${index + 1}. ${escapeMarkdown(text)}`)].join("\n"))
            .setFooter({ text: fr ? "Automatisation volontaire · /automation question" : "Opt-in automation · /automation question" })],
          components: pollId ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...settings.options.map((text, index) =>
            new ButtonBuilder().setCustomId(`poll:${pollId}:${index}`).setLabel(text).setStyle(ButtonStyle.Primary)))] : [], allowedMentions: { parse: [] } });
          return message.id;
        },
      }, now);
    }
    let afterMemberId: string | undefined;
    for (;;) {
      const recaps = await db.recurringRecap.findMany({ where: { guildId: setting.guildId, enabled: true, ...(afterMemberId ? { memberId: { gt: afterMemberId } } : {}) }, include: { member: true }, take: 500, orderBy: { memberId: "asc" } });
      if (!recaps.length) break;
      afterMemberId = recaps[recaps.length - 1]!.memberId;
      for (const recap of recaps) {
        const parsed = recurringScheduleSchema.safeParse(recap.settings);
        if (!parsed.success || !recurringDue(parsed.data, now)) continue;
        const authorize = async () => {
          const member = await guild.members.fetch({ user: recap.member.discordUserId, force: true }).catch(() => null);
          const role = currentGuildScope()?.memberRoleId;
          return !!member && (!role || member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.has(role));
        };
        await deliverRecurringRecap(db, recap.memberId, { authorize,
          send: async () => {
            const member = await guild.members.fetch({ user: recap.member.discordUserId, force: true });
            const result = await personalWeeklyRecap(db, setting.guildId, member.id, now, async channelId => {
              const channel = await guild.channels.fetch(channelId).catch(() => null);
              return !!channel && "permissionsFor" in channel && !!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
            });
            const fr = setting.language === "fr";
            const embed = personalWeeklyRecapEmbed(result, fr ? "fr" : "en").setFooter({ text: fr ? "Votre bilan privé · Pause : /automation recap action:off" : "Your private recap · Pause: /automation recap action:off" });
            // Recheck after loading private data, immediately before transmission.
            const authorized = await authorize();
            const current = await db.recurringRecap.findUnique({ where: { memberId: recap.memberId } });
            if (!current?.enabled || current.revision !== recap.revision || !authorized || !recurringDue(parsed.data, deliveryTime())) throw new Error("Recipient consent changed");
            return (await member.send({ embeds: [embed], allowedMentions: { parse: [] } })).id;
          },
        }, now);
      }
    }
  });
}
