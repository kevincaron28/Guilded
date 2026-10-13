import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { buildConsumableLines, buildReadinessLines, chunkLines } from "../services/readiness-board.js";
import { requireGuildContext } from "./context.js";

export const readinessCommand = new SlashCommandBuilder()
  .setName("readiness").setDescription("Review raid readiness.")
  .addSubcommand((sub) => sub.setName("me").setDescription("Show your latest readiness."))
  .addSubcommand((sub) => sub.setName("member").setDescription("Show a member's readiness.")
    .addUserOption((o) => o.setName("player").setDescription("Guild member").setRequired(true)))
  .addSubcommand((sub) => sub.setName("raid").setDescription("Show latest readiness for the guild, most actionable first.")
    .addStringOption((o) => o.setName("attunement").setDescription("Target raid: also flag anyone without this attunement (e.g. Onyxia Key)")));

function canReview(interaction: ChatInputCommandInteraction): boolean {
  return !!interaction.member && (
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "guildMaster") ||
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "raidLeader") ||
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "lootLeader") ||
    hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "classLeader")
  );
}

type ReadinessSummary = {
  status: string;
  itemLevel: number | null;
  findings: Array<{ severity: string; message: string }>;
};

function format(snapshot: ReadinessSummary | null, name: string): string {
  if (!snapshot) return `${name}: UNKNOWN — no inspection has been uploaded.`;
  const findings = snapshot.findings.map((finding) => `${finding.severity}: ${finding.message}`).join("\n");
  return `${name}: **${snapshot.status}**${snapshot.itemLevel ? ` | item level ${snapshot.itemLevel}` : ""}${findings ? `\n${findings}` : ""}`;
}

export async function executeReadiness(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== "me" && !canReview(interaction)) {
    await interaction.reply({ content: "Only Guild Masters, Officers, Raid Leaders, Loot Leaders, and Class Leaders can review other members.", ephemeral: true });
    return;
  }
  if (subcommand === "me") {
    const snapshot = await prisma.inspectedCharacterSnapshot.findFirst({ where: { memberId: context.memberId }, orderBy: { inspectedAt: "desc" }, include: { findings: true, character: true } });
    await interaction.reply({ content: format(snapshot, snapshot?.character.name ?? interaction.user.username), ephemeral: true });
    return;
  }
  if (subcommand === "member") {
    const user = interaction.options.getUser("player", true);
    const member = await prisma.member.findUnique({ where: { guildId_discordUserId: { guildId: context.guildId, discordUserId: user.id } } });
    const snapshot = member ? await prisma.inspectedCharacterSnapshot.findFirst({ where: { memberId: member.id }, orderBy: { inspectedAt: "desc" }, include: { findings: true, character: true } }) : null;
    await interaction.reply({ content: format(snapshot, user.username), ephemeral: true });
    return;
  }
  // On-demand reports stay private; automatic imports own the daily channel post.
  const attunement = interaction.options.getString("attunement") ?? undefined;
  const chunks = chunkLines([...await buildReadinessLines(prisma, context.guildId, { attunement }), ...await buildConsumableLines(prisma, context.guildId)], 1900);
  await interaction.reply({ content: chunks[0] ?? "No guild members found.", ephemeral: true });
  for (const chunk of chunks.slice(1)) await interaction.followUp({ content: chunk, ephemeral: true });
}
