import { createHash } from "node:crypto";
import type { DiscordJob, PrismaClient } from "@prisma/client";
import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Guild, type Message, type TextChannel } from "discord.js";
import { eventBoardEmbeds, eventDetails, eventLock, eventText, reminderDue, reminderSettings } from "./game-events.js";
import { selfRoleProblem } from "./selfrole.js";

export function missingDiscordMessage(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === 10008;
}
export async function eventChannel(guild: Guild, channelId: string): Promise<TextChannel> {
  const channel = await guild.channels.fetch(channelId, { force: true });
  const me = await guild.members.fetchMe({ force: true });
  if (channel?.type !== ChannelType.GuildText || !channel.permissionsFor(me)?.has([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages
  ])) throw new Error("Event board needs View Channel, Send Messages, Embed Links, Read Message History and Manage Messages in a text channel. / Permissions du tableau insuffisantes.");
  return channel;
}
export async function eventRole(guild: Guild, roleId: string, channel: TextChannel) {
  const role = await guild.roles.fetch(roleId, { force: true });
  if (!role || selfRoleProblem({ id: role.id, managed: role.managed, permissions: role.permissions.bitfield }, guild.id) ||
      !role.mentionable || !channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error("Choose a mentionable, non-privileged opt-in game role that can view the channel. / Choisissez un rôle de jeu volontaire, mentionnable, sans privilèges et ayant accès au salon.");
  }
  return role;
}

/** Scan back to the durable intent, not just 100 messages. Never resend on an unreadable history. */
export async function findEventMessage(channel: TextChannel, marker: string, since: Date): Promise<Message | null> {
  let before: string | undefined;
  for (;;) {
    const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const found = messages.find(message => message.author.id === channel.client.user.id && message.embeds.some(embed => embed.footer?.text === marker));
    if (found) return found;
    const oldest = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
    if (messages.size < 100 || !oldest || oldest.createdTimestamp < since.getTime() - 60_000) return null;
    if (oldest.id === before) throw new Error("Event message recovery did not advance");
    before = oldest.id;
  }
}

/** Uses the same database lock as edits: no cancellation/reschedule can race the final send check. */
export async function deliverGameEvent(guild: Guild, database: PrismaClient, job: DiscordJob, now = new Date()): Promise<void> {
  const payload = job.payload as Record<string, unknown>;
  await database.$transaction(async tx => {
    await eventLock(tx);
    const board = await tx.gameEventBoard.findFirst({ where: { id: String(payload['boardId']), guildId: job.guildId, guild: { discordId: guild.id } }, include: { guild: { include: { settings: true } } } });
    if (!board || (!board.enabled && job.kind === "GAME_EVENT_REMINDER")) return;
    const fr = board.guild.settings?.language === "fr";
    if (job.kind === "GAME_EVENT_REMINDER") {
      const event = await tx.officialGameEvent.findUnique({ where: { id: String(payload['eventId']) } });
      const minutes = Number(payload['minutes']);
      if (!event || event.scheduleVersion !== payload['scheduleVersion'] || !reminderDue(event, board, minutes, now)) return;
      const channel = await eventChannel(guild, board.channelId);
      const role = await eventRole(guild, reminderSettings(board, event.game).role!, channel);
      const marker = `Guilded event reminder ${job.id}`;
      if (await findEventMessage(channel, marker, job.createdAt)) return;
      // History/permission checks may take time. Expire reminders against the actual clock too.
      if (!reminderDue(event, board, minutes, new Date(Math.max(now.getTime(), Date.now())))) return;
      const label = minutes === 0 ? eventText(fr, "Scheduled time reached", "Heure prévue atteinte") : `${minutes === 1440 ? 24 : 1} h`;
      await channel.send({ content: `<@&${role.id}>`,
        embeds: [new EmbedBuilder().setTitle(`${label} · ${fr ? event.titleFr : event.titleEn}`)
          .setDescription(`${eventDetails(event, fr, now)}\n${eventText(fr, "This is not confirmation that servers are online.", "Ceci ne confirme pas que les serveurs sont en ligne.")}`)
          .setFooter({ text: marker })], allowedMentions: { parse: [], roles: [role.id], users: [], repliedUser: false },
        nonce: createHash("sha256").update(job.id).digest("hex").slice(0, 24), enforceNonce: true });
      return;
    }
    if (!board.enabled && !board.messageId) return;
    const channel = await eventChannel(guild, board.channelId);
    const marker = `Guilded events ${board.id}`;
    let message: Message | null = null;
    if (board.messageId) {
      try { message = await channel.messages.fetch({ message: board.messageId, force: true }); }
      catch (error) { if (!missingDiscordMessage(error)) throw error; }
      if (message && (message.author.id !== guild.client.user?.id || !message.embeds.some(embed => embed.footer?.text === marker))) throw new Error("Event board identity mismatch");
    }
    if (!message) {
      // Covers a restart between Discord accepting the board and committing its message ID.
      message = await findEventMessage(channel, marker, board.createdAt);
    }
    if (!message && !board.enabled) return;
    const events = await tx.officialGameEvent.findMany({ where: { archived: false }, orderBy: { id: "asc" } });
    const embeds = eventBoardEmbeds(events, board, fr, now);
    const hash = createHash("sha256").update(JSON.stringify(embeds.map(embed => embed.toJSON()))).digest("hex");
    if (!message) {
      message = await channel.send({ embeds, allowedMentions: { parse: [] }, nonce: board.id.slice(-25), enforceNonce: true });
    } else if (board.contentHash !== hash) {
      await message.edit({ embeds, allowedMentions: { parse: [] } });
    }
    if (board.enabled && !message.pinned) await message.pin();
    if (!board.enabled && message.pinned) await message.unpin();
    await tx.gameEventBoard.update({ where: { id: board.id }, data: { messageId: message.id, contentHash: hash } });
  }, { timeout: 60_000, maxWait: 10_000 });
}
