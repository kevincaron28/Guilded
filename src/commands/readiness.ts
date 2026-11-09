import { AttachmentBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { asLang } from "../i18n.js";
import { scoreCardPng } from "../services/score-card.js";
import { raidNightCard, raidNightCheck, raidNightEmbed } from "../services/raid-night-check.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { buildConsumableLines, buildReadinessLines, chunkLines } from "../services/readiness-board.js";
import { requireGuildContext } from "./context.js";
import { assessRaidReadiness, raidLevel, type RaidReadinessSnapshot } from "../services/readiness.js";

export const readinessCommand = new SlashCommandBuilder()
  .setName("readiness").setDescription("Review raid readiness.")
  .addSubcommand((sub) => sub.setName("me").setDescription("Show your latest readiness."))
  .addSubcommand((sub) => sub.setName("member").setDescription("Show a member's readiness.")
    .addUserOption((o) => o.setName("player").setDescription("Guild member").setRequired(true)))
  .addSubcommand((sub) => sub.setName("raid").setDescription("Show latest readiness for the guild, most actionable first.")
    .addStringOption((o) => o.setName("attunement").setDescription("Target raid: also flag anyone without this attunement (e.g. Onyxia Key)"))
    .addBooleanOption((o) => o.setName("posts").setDescription("Officers: daily list and pre-raid check posts (default on)")
      .setDescriptionLocalizations({ fr: "Officiers : liste du jour et vérification avant raid (actives par défaut)" })));

function canReview(interaction: ChatInputCommandInteraction): boolean {
  return !!interaction.member && (
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "guildMaster") ||
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "raidLeader") ||
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "lootLeader") ||
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "classLeader")
  );
}

type ReadinessSummary = RaidReadinessSnapshot & {
  itemLevel: number | null;
  findings: Array<{ severity: string; message: string }>;
};

function format(snapshot: ReadinessSummary | null, name: string): string {
  if (!snapshot) return `${name}: UNKNOWN — no inspection has been uploaded.`;
  const assessment = assessRaidReadiness(snapshot);
  const findings = snapshot.findings.map((finding) => `${finding.severity}: ${finding.message}`).join("\n");
  return `${name}: **${assessment.status}** | level ${snapshot.character.level ?? "unknown"}/${raidLevel()}${snapshot.itemLevel ? ` | item level ${snapshot.itemLevel}` : ""}${assessment.reason ? `\n${assessment.reason}` : ""}${findings ? `\nGear check findings:\n${findings}` : ""}`;
}

export async function executeReadiness(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== "me" && !canReview(interaction)) {
    await interaction.reply({ content: "Only Guild Masters, Officers, Raid Leaders, Loot Leaders, and Class Leaders can review other members.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "me") {
    const snapshot = await prisma.inspectedCharacterSnapshot.findFirst({ where: { memberId: context.memberId }, orderBy: { inspectedAt: "desc" }, include: { findings: true, character: true } });
    await interaction.reply({ content: format(snapshot, snapshot?.character.name ?? interaction.user.username), flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "member") {
    const user = interaction.options.getUser("player", true);
    const member = await prisma.member.findUnique({ where: { guildId_discordUserId: { guildId: context.guildId, discordUserId: user.id } } });
    const snapshot = member ? await prisma.inspectedCharacterSnapshot.findFirst({ where: { memberId: member.id }, orderBy: { inspectedAt: "desc" }, include: { findings: true, character: true } }) : null;
    await interaction.reply({ content: format(snapshot, user.username), flags: MessageFlags.Ephemeral });
    return;
  }
  const posts = interaction.options.getBoolean("posts");
  if (posts !== null) {
    const lang = asLang((await prisma.guildSettings.findUnique({ where: { guildId: context.guildId }, select: { language: true } }))?.language);
    if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
      await interaction.reply({ content: lang === "fr" ? "Réservé aux officiers." : "Officers only.", flags: MessageFlags.Ephemeral });
      return;
    }
    await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { readinessPostsEnabled: posts } });
    await interaction.reply({ content: posts
      ? lang === "fr" ? "🛡️ Publications de préparation actives : la liste du jour et la vérification ~4 h avant chaque raid." : "🛡️ Readiness posts are on: the daily list and the check about 4 hours before each raid."
      : lang === "fr" ? "Publications de préparation désactivées. Cette commande fonctionne toujours en privé." : "Readiness posts are off. This command still works privately.", flags: MessageFlags.Ephemeral });
    return;
  }
  // On-demand reports stay private; automatic imports own the daily channel post.
  // 9.1: the next planned raid's check (card) comes first, when one is planned within a week.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: context.guildId }, select: { language: true, timezone: true } });
  const now = new Date();
  let first = true;
  const next = await prisma.raid.findFirst({ where: { guildId: context.guildId, status: "PLANNED", isTest: false, scheduledAt: { gt: new Date(now.getTime() - 60 * 60_000), lte: new Date(now.getTime() + 7 * 86_400_000) } }, orderBy: { scheduledAt: "asc" }, select: { id: true } });
  const check = next ? await raidNightCheck(prisma, context.guildId, next.id, now) : null;
  if (check) {
    const lang = asLang(settings?.language);
    const embed = raidNightEmbed(check, lang);
    const png = await scoreCardPng(raidNightCard(check, lang, settings?.timezone ?? "America/Toronto")).catch(() => null);
    if (png) embed.setImage("attachment://raid-check.png");
    await interaction.editReply({ embeds: [embed], ...(png ? { files: [new AttachmentBuilder(png, { name: "raid-check.png" })] } : {}) });
    first = false;
  }
  const send = async (content: string) => { if (first) { first = false; await interaction.editReply({ content }); } else await interaction.followUp({ content, flags: MessageFlags.Ephemeral }); };
  const attunement = interaction.options.getString("attunement") ?? undefined;
  const lang = asLang(settings?.language);
  const chunks = chunkLines([...await buildReadinessLines(prisma, context.guildId, { attunement, lang }), ...await buildConsumableLines(prisma, context.guildId, now, lang)], 1900);
  await send(chunks[0] ?? (lang === "fr" ? "Aucun membre de la guilde trouvé." : "No guild members found."));
  for (const chunk of chunks.slice(1)) await send(chunk);
}
