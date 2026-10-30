import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import { currentGuildScope, withGuildScope } from "./guild-scope.js";
import { deliverGroupWatch, groupWatchEvents } from "./group-watch.js";
import { subscriptionPreview } from "./group-subscription.js";

/** Approval-gated dispatcher; deliberately not registered with a timer in this
 * change. The release owner must record audience/channel/cadence approval first.
 * No DM fallback, no role mentions and no changed-channel substitution. */
export async function dispatchGroupWatches(client: Client, database: PrismaClient, now = new Date()) {
  const settings = await database.guildSettings.findMany({ where: { ...pilotGuildScope, targetedAlertsEnabled: true, targetedAlertsChannelId: { not: null } }, include: { guild: true } });
  for (const setting of settings) await withGuildScope(database, setting.guildId, async () => {
    const guild = client.guilds.cache.get(setting.guild.discordId);
    if (!guild) return;
    const alerts = await database.groupAlert.findMany({ where: { guildId: setting.guildId }, take: 100, orderBy: { memberId: "asc" },
      include: { member: { select: { discordUserId: true, characters: { select: { level: true } } } } } });
    const events = (await groupWatchEvents(database, setting.guildId, now)).filter(event => event.channelId === setting.targetedAlertsChannelId).slice(0, 10);
    for (const alert of alerts.filter(row => row.subscription)) for (const event of events) {
      if (event.excludedMemberIds.includes(alert.memberId) || !subscriptionPreview({ subscription: alert.subscription,
        candidate: { discordUserId: alert.member.discordUserId, kinds: alert.kinds, roles: alert.roles, levels: alert.member.characters.map(character => character.level) },
        event, now, history: [], isMember: true, canViewChannel: true }).eligible) continue;
      const result = await deliverGroupWatch(database, { guildId: setting.guildId, memberId: alert.memberId, eventKey: event.key,
        loadEvent: async () => (await groupWatchEvents(database, setting.guildId)).find(row => row.key === event.key) ?? null,
        access: async (userId, channelId) => {
          const [member, channel, bot] = await Promise.all([guild.members.fetch(userId).catch(() => null), guild.channels.fetch(channelId).catch(() => null), guild.members.fetchMe().catch(() => null)]);
          if (!member || !bot || channel?.type !== ChannelType.GuildText) return false;
          const role = currentGuildScope()?.memberRoleId;
          return (!role || member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.has(role))
            && channel.permissionsFor(member).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
            && channel.permissionsFor(bot).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
        },
        send: async (userId, current) => {
          const channel = await guild.channels.fetch(current.channelId);
          if (channel?.type !== ChannelType.GuildText) throw new Error("Target channel unavailable");
          const text = setting.language === "fr" ? "Une place correspond à vos préférences" : "An opening matches your preferences";
          const message = await channel.send({ content: `<@${userId}> ${text}: https://discord.com/channels/${guild.id}/${current.channelId}/${current.messageId}`,
            allowedMentions: { users: [userId], roles: [], parse: [] } });
          return message.id;
        }
      });
      if (["sent", "uncertain", "cancelled"].includes(result)) break;
    }
  });
}
