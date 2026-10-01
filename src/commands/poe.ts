import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { requireGuildContext } from "./context.js";
import { issueCharacterPairingCode } from "../services/character-pairing.js";
import { createPoeMappingService, POE_MODES } from "../services/poe-mapping.js";

export const poeCommand = new SlashCommandBuilder().setName("poe").setDescription("PoE2 mapping journal and companion")
  .addSubcommand(sub => sub.setName("setup").setDescription("Enable or pause PoE2 tracking (officers)").addBooleanOption(option => option.setName("enabled").setDescription("Accept personal mapping journals").setRequired(true)))
  .addSubcommand(sub => sub.setName("pair").setDescription("Pair your companion with this Discord account"))
  .addSubcommand(sub => sub.setName("status").setDescription("How to track maps and check guild settings"))
  .addSubcommand(sub => sub.setName("runs").setDescription("Your last 15 observed map visits").addStringOption(option => option.setName("league").setDescription("Filter by declared league").setMaxLength(100)))
  .addSubcommand(sub => sub.setName("summary").setDescription("Mapping activity for one league and mode")
    .addStringOption(option => option.setName("league").setDescription("Declared league name").setRequired(true).setMaxLength(100))
    .addStringOption(option => option.setName("mode").setDescription("League mode").setRequired(true).addChoices(...POE_MODES.map(value => ({ name: value, value }))))
    .addIntegerOption(option => option.setName("days").setDescription("Last 1–90 days (default 7)").setMinValue(1).setMaxValue(90))
    .addBooleanOption(option => option.setName("guild").setDescription("Show guild activity instead of only yours")));

export async function executePoe(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Use this in your server / À utiliser dans votre serveur.", ephemeral: true }); return; }
  await interaction.deferReply({ ephemeral: true });
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const { guildId, memberId } = context;
  const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
  const fr = settings?.language === "fr";
  const T = (en: string, french: string) => fr ? french : en;
  const sub = interaction.options.getSubcommand();
  const service = createPoeMappingService(prisma);
  const notice = T("Log observations; characters/leagues are declared. Visits are not verified clears and earn no points. Guilded is independent of Grinding Gear Games.", "Observations du journal; personnages/ligues déclarés. Les visites ne prouvent pas une réussite et ne donnent aucun point. Guilded est indépendant de Grinding Gear Games.");
  if (sub === "setup") {
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    if (!hasPermission(member, "officer")) { await interaction.editReply(T("Officers only.", "Officiers seulement.")); return; }
    const enabled = interaction.options.getBoolean("enabled", true);
    await prisma.$transaction(async tx => {
      await tx.guildSettings.upsert({ where: { guildId }, create: { guildId, poeTrackingEnabled: enabled }, update: { poeTrackingEnabled: enabled } });
      await tx.auditLog.create({ data: { guildId, actorId: interaction.user.id, action: "CONFIG_UPDATED", metadata: { poeTrackingEnabled: enabled } } });
    });
    await interaction.editReply(T(`PoE2 mapping ${enabled ? "enabled" : "paused"}. Members opt in in the companion. /poe status`, `Suivi PoE2 ${enabled ? "activé" : "en pause"}. Chaque membre l'active dans le compagnon. /poe status`));
    return;
  }
  if (sub === "pair") {
    const pair = await issueCharacterPairingCode(prisma, guildId, memberId);
    await interaction.editReply(T(`Companion code: **${pair.code}** (15 minutes). Enter it in Settings → Link Discord account. Existing paired companions can use the same link for WoW and PoE2.`, `Code du compagnon : **${pair.code}** (15 minutes). Entrez-le dans Settings → Link Discord account. Un compagnon déjà jumelé utilise le même lien pour WoW et PoE2.`));
    return;
  }
  const embed = new EmbedBuilder().setColor(0xbb9145).setFooter({ text: notice });
  if (sub === "runs") {
    const rows = await service.recent(guildId, memberId, interaction.options.getString("league")?.trim());
    embed.setTitle(T("PoE2 — Your map visits", "PoE2 — Vos visites de cartes")).setDescription(rows.map(row =>
      `**${escapeMarkdown(row.areaId)}** · ${T("area level", "niveau de zone")} ${row.areaLevel} · ${row.durationSeconds === null ? T("time unknown", "durée inconnue") : `${Math.round(row.durationSeconds / 60)} min`}\n${escapeMarkdown(row.character)} · ${escapeMarkdown(row.league)} · ${row.mode} · <t:${Math.floor(row.startedAt.getTime() / 1000)}:f>`
    ).join("\n\n").slice(0, 4000) || T("No visits yet. /poe status", "Aucune visite. /poe status"));
  } else if (sub === "summary") {
    const league = interaction.options.getString("league", true).trim();
    const mode = interaction.options.getString("mode", true) as typeof POE_MODES[number];
    const days = interaction.options.getInteger("days") ?? 7;
    const rows = await service.summary(guildId, league, mode, days, interaction.options.getBoolean("guild") ? undefined : memberId);
    embed.setTitle(T("PoE2 — Mapping activity", "PoE2 — Activité de mapping")).setDescription(`${escapeMarkdown(league)} · ${mode} · ${days} ${T("days", "jours")}\n\n` + (rows.map(row =>
      `**${escapeMarkdown(row.name)}**: ${row.visits} ${T("visits", "visites")} · ${Math.round(row.seconds / 60)} min (${row.timedVisits} ${T("timed", "chronométrées")})`
    ).join("\n").slice(0, 3500) || T("No observations for this league/mode.", "Aucune observation pour cette ligue/mode.")));
  } else {
    embed.setTitle("PoE2 — Companion").setDescription(T(
      `Tracking: **${settings?.poeTrackingEnabled ? "enabled" : "paused"}**\n1. An officer enables /poe setup enabled:true.\n2. Use /poe pair, or keep your existing companion pairing.\n3. In companion Settings, enable PoE2, choose logs/Client.txt from your PoE2 install and enter your character, league and mode. WoW can be switched off.\n4. Save and start. New map visits appear after the next area change. /poe runs · /poe summary\n\nOnly map timing is shared with your guild. Chat and paths are never uploaded. Change the declared character/league before playing another character. Challenges and reviewed points use /community.`,
      `Suivi : **${settings?.poeTrackingEnabled ? "activé" : "en pause"}**\n1. Un officier active /poe setup enabled:true.\n2. Utilisez /poe pair ou gardez le jumelage existant.\n3. Dans Settings du compagnon, activez PoE2, choisissez logs/Client.txt de votre installation PoE2 et indiquez personnage, ligue et mode. WoW peut être désactivé.\n4. Save and start. Les nouvelles visites arrivent au prochain changement de zone. /poe runs · /poe summary\n\nSeule la durée des cartes est partagée avec la guilde. Aucune conversation ni chemin de fichier envoyé. Changez le personnage/la ligue déclarés avant de changer de personnage en jeu. Les défis et points révisés utilisent /community.`));
  }
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
