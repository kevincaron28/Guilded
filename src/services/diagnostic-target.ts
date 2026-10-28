import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";

/** Fail closed: notification audience is administrators and this bot only. */
export async function diagnosticTarget(client: Client | null, channelId: string | undefined) {
  if (!client?.user || !channelId) return null;
  try {
    const channel = await client.channels.fetch(channelId, { force: true });
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    const roles = await channel.guild.roles.fetch();
    const me = await channel.guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return null;
    for (const role of roles.values()) {
      if (role.permissions.has(PermissionFlagsBits.Administrator) || role.tags?.botId === client.user.id) continue;
      if (channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) return null;
    }
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.type !== 1 || overwrite.id === client.user.id) continue;
      const member = await channel.guild.members.fetch(overwrite.id).catch(() => null);
      if (!member || !member.permissions.has(PermissionFlagsBits.Administrator) && channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return null;
    }
    return { channel, id: channel.id, label: `#${channel.name} (${channel.guild.name})` };
  } catch { return null; }
}
