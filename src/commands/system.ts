import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { ALL_CHANNELS } from "./setup.js";
import { guildService } from "./context.js";
import { runDiscordJobs } from "../services/discord-jobs.js";

export const systemCommand = new SlashCommandBuilder().setName("system").setDescription("Sync status, delivery retries and bot permissions (officers)")
  .addSubcommand(sub => sub.setName("status").setDescription("See pairing, imports, Discord updates and permissions"))
  .addSubcommand(sub => sub.setName("retry").setDescription("Retry pending Discord updates now"))
  .addSubcommand(sub => sub.setName("permissions").setDescription("Permissions needed without Administrator"));

export const REQUIRED_BOT_PERMISSIONS = ["ViewChannel", "SendMessages", "EmbedLinks", "AttachFiles", "ReadMessageHistory", "ManageChannels", "ManageRoles", "ManageMessages", "PinMessages", "AddReactions", "CreatePublicThreads", "SendMessagesInThreads", "ManageThreads", "Connect", "Speak", "MoveMembers", "KickMembers", "BanMembers", "ModerateMembers", "CreateEvents"] as const;

export async function executeSystem(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Use this in your Discord server.", ephemeral: true }); return; }
  const officer = await interaction.guild.members.fetch(interaction.user.id);
  if (!hasPermission(officer as GuildMember, "officer")) { await interaction.reply({ content: "Officers only / Officiers seulement.", ephemeral: true }); return; }
  await interaction.deferReply({ ephemeral: true });
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const sub = interaction.options.getSubcommand();
  if (sub === "retry") {
    await prisma.discordJob.updateMany({ where: { guildId: guild.id, status: "PENDING" }, data: { nextAttemptAt: new Date() } });
    await runDiscordJobs(interaction.client);
  }
  const settings = await guildService.getSettings(guild.id);
  const me = await interaction.guild.members.fetchMe();
  const missing = REQUIRED_BOT_PERMISSIONS.filter(permission => !me.permissions.has(PermissionFlagsBits[permission], false));
  const administrator = me.permissions.has(PermissionFlagsBits.Administrator);
  const permissions = `Administrator: ${administrator ? "enabled — remove after granting the permissions below / activé" : "off / désactivé"}\n${missing.length ? `Missing / Manquantes: ${missing.join(", ")}` : "Required permissions granted / Permissions requises accordées"}`;
  if (sub === "permissions") {
    await interaction.editReply({ content: `${permissions}\n\n${REQUIRED_BOT_PERMISSIONS.join(", ")}\nPlace the bot's role above roles it manages. Channel overrides can still deny access. / Placez le rôle du bot au-dessus des rôles qu'il gère.`, allowedMentions: { parse: [] } });
    return;
  }
  const [paired, latest, waiting, pending, delivered] = await Promise.all([
    prisma.companionCredential.count({ where: { revokedAt: null, member: { guildId: guild.id } } }),
    prisma.addonImport.findFirst({ where: { guildId: guild.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } }),
    prisma.addonImport.count({ where: { guildId: guild.id, status: "PREVIEWED" } }),
    prisma.discordJob.findMany({ where: { guildId: guild.id, status: "PENDING" }, orderBy: { nextAttemptAt: "asc" }, take: 8 }),
    prisma.discordJob.findFirst({ where: { guildId: guild.id, status: "DONE" }, orderBy: { deliveredAt: "desc" } })
  ]);
  const channels = await interaction.guild.channels.fetch();
  const channelProblems: string[] = [];
  for (const field of ALL_CHANNELS) {
    const id = settings?.[field];
    const channel = id ? channels.get(id) : null;
    if (!channel) { channelProblems.push(`${field}: ${id ? "deleted / supprimé" : "not configured / non configuré"}`); continue; }
    const permissions = channel.permissionsFor(me);
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (!permissions?.has(needed)) channelProblems.push(`${channel.name}: permission denied / accès refusé`);
  }
  const time = (date: Date | null | undefined) => date ? `<t:${Math.floor(date.getTime() / 1000)}:R>` : "none / aucune";
  const embed = new EmbedBuilder().setColor(pending.length || channelProblems.length ? 0xe0a33a : 0x36a863).setTitle("Guilded — Sync / Synchronisation")
    .setDescription("Companion activity is shown by uploads, not guessed from Discord online status. / L'activité du compagnon est mesurée par ses envois.")
    .addFields(
      { name: "Game → database / Jeu → base", value: `Active pairings / Jumelages: ${paired}\nLast upload / Dernier envoi: ${time(latest?.createdAt)} (${latest?.status ?? "none"})\nWaiting for approval / En attente: ${waiting}\nAuto-apply / Application auto: ${settings?.autoApplyImports ? "on" : "off"}\nAfter a reset, obtain a new /character pair code.` },
      { name: "Database → Discord / Base → Discord", value: `Last delivery / Dernière publication: ${time(delivered?.deliveredAt)}\n${pending.length ? pending.map(job => `${job.kind}: ${job.attempts} attempt(s), ${job.lastError ?? "queued"} · retry ${time(job.nextAttemptAt)}`).join("\n") : "No pending deliveries / Aucune publication en attente"}\n/system retry` },
      { name: "Channels / Salons", value: (channelProblems.join("\n") || "Configured channels accessible / Salons configurés accessibles").slice(0, 1024) },
      { name: "Permissions", value: permissions.slice(0, 1024) }
    );
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
