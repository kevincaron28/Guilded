import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createAuditService } from "../services/audit.js";
import { postToLogChannel } from "../services/housekeeping.js";
import { hierarchyError, parseDuration, requireReason } from "../services/moderation.js";
import { requireGuildContext } from "./context.js";

const auditService = createAuditService(prisma);

const MODERATION_ACTIONS = ["MODERATION_WARN", "MODERATION_TIMEOUT", "MODERATION_KICK", "MODERATION_BAN"] as const;

export const moderationCommand = new SlashCommandBuilder()
  .setName("mod")
  .setDescription("Moderation tools (officers only). Every action is written to the audit log.")
  .addSubcommand((sub) => sub.setName("warn").setDescription("Record a warning and DM the member.")
    .addUserOption((o) => o.setName("player").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((sub) => sub.setName("timeout").setDescription("Temporarily mute a member.")
    .addUserOption((o) => o.setName("player").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m, 2h, 1d (max 28d)").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((sub) => sub.setName("kick").setDescription("Kick a member.")
    .addUserOption((o) => o.setName("player").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((sub) => sub.setName("ban").setDescription("Ban a member (works on users no longer in the server).")
    .addUserOption((o) => o.setName("player").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500))
    .addIntegerOption((o) => o.setName("delete_days").setDescription("Days of their messages to delete (0-7)").setMinValue(0).setMaxValue(7)))
  .addSubcommand((sub) => sub.setName("history").setDescription("Show moderation history for a member.")
    .addUserOption((o) => o.setName("player").setDescription("Member").setRequired(true)));

export async function executeModeration(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context || !interaction.guild) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers, Guild Masters, or administrators can use moderation tools.", flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const user = interaction.options.getUser("player", true);

  if (subcommand === "history") {
    const entries = await prisma.auditLog.findMany({
      where: {
        guildId: context.guildId,
        action: { in: [...MODERATION_ACTIONS] },
        metadata: { path: ["targetId"], equals: user.id }
      },
      orderBy: { createdAt: "desc" },
      take: 10
    });
    await interaction.reply({
      content: entries.length
        ? [`Moderation history for ${user.tag}:`, ...entries.map((entry) => {
          const meta = entry.metadata as { reason?: string };
          return `${entry.createdAt.toISOString().slice(0, 10)} ${entry.action.replace("MODERATION_", "")} by <@${entry.actorId}> - ${meta.reason ?? "no reason"}`;
        })].join("\n")
        : `No moderation history for ${user.tag}.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return;
  }

  const reason = requireReason(interaction.options.getString("reason", true));
  const guild = interaction.guild;
  const actor = interaction.member as GuildMember;
  const target = await guild.members.fetch(user.id).catch(() => null);

  if (target) {
    const problem = hierarchyError({
      actorPosition: actor.roles.highest.position,
      targetPosition: target.roles.highest.position,
      botPosition: guild.members.me?.roles.highest.position ?? 0,
      actorIsOwner: guild.ownerId === actor.id,
      targetIsOwner: guild.ownerId === target.id
    });
    if (problem) throw new Error(problem);
  } else if (subcommand !== "ban") {
    throw new Error("That user is not in this server.");
  }
  if (user.id === interaction.user.id) throw new Error("You cannot moderate yourself.");
  if (user.bot && user.id === interaction.client.user.id) throw new Error("Nice try.");

  const metadata: Record<string, string | number> = { targetId: user.id, targetTag: user.tag, reason };
  let action: (typeof MODERATION_ACTIONS)[number];
  let summary: string;

  if (subcommand === "warn") {
    action = "MODERATION_WARN";
    const dmSent = await user.send(`You received a warning in ${guild.name}: ${reason}`).then(() => true).catch(() => false);
    summary = `Warned ${user.tag}${dmSent ? "" : " (their DMs are closed, so they were not notified)"}.`;
  } else if (subcommand === "timeout") {
    action = "MODERATION_TIMEOUT";
    const ms = parseDuration(interaction.options.getString("duration", true));
    await target!.timeout(ms, reason);
    metadata["durationMs"] = ms;
    summary = `Timed out ${user.tag} for ${interaction.options.getString("duration", true)}.`;
  } else if (subcommand === "kick") {
    action = "MODERATION_KICK";
    await target!.kick(reason);
    summary = `Kicked ${user.tag}.`;
  } else {
    action = "MODERATION_BAN";
    const days = interaction.options.getInteger("delete_days") ?? 0;
    await guild.members.ban(user.id, { reason, deleteMessageSeconds: days * 86_400 });
    summary = `Banned ${user.tag}.`;
  }

  await auditService.record({ guildId: context.guildId, actorId: interaction.user.id, action, entityId: user.id, metadata });
  await postToLogChannel(guild, `${summary} By ${interaction.user.tag}. Reason: ${reason}`);
  await interaction.reply({ content: summary, flags: MessageFlags.Ephemeral });
}
