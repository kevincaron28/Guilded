import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createAuditService } from "../services/audit.js";
import { applyRaidEpProposal, computeRaidEpProposal, type EpProposal } from "../services/ep-award.js";
import { notifications, notify } from "../services/notify.js";
import { guildService } from "./context.js";
import { postRaidReport } from "./raid-report.js";

export const EP_AWARD_PREFIX = "epaward:";
const auditService = createAuditService(prisma);

function proposalEmbed(proposal: EpProposal): EmbedBuilder {
  let lines = "";
  for (const row of proposal.rows) {
    const line = `${row.name} — **${row.ep} EP**${row.status === "LATE" ? " (late)" : row.status === "BENCHED" ? " (bench)" : ""}\n`;
    if (lines.length + line.length > 3800) { lines += "…"; break; }
    lines += line;
  }
  const breakdown = [
    `${proposal.bossesKilled}/${proposal.bossesPlanned} bosses × ${proposal.perBoss} EP`,
    proposal.completionBonus ? `full-clear bonus ${proposal.completionBonus} EP` : null
  ].filter(Boolean).join(", ");
  return new EmbedBuilder()
    .setTitle(`EP for ${proposal.title}`)
    .setDescription(lines || "Nobody is marked present or late yet.")
    .setFooter({ text: `Attendance EP + ${breakdown}. ${proposal.coreName ? `Rules: ${proposal.coreName} core (/core rules; anything it doesn't change follows /config).` : "Amounts come from /config (attendance, late, boss kill, full-clear bonus)."}${proposal.poolCoreId ? ` Paid into the ${proposal.coreName} pool.` : ""}` });
}

// Shows the proposed EP for a raid to the officer with Approve / Cancel
// buttons. Used by /raid end and /raid award-ep. Nothing is written yet.
export async function showEpProposal(interaction: ChatInputCommandInteraction, guildId: string, raidId: string, header: string): Promise<void> {
  const proposal = await computeRaidEpProposal(prisma, guildId, raidId);
  if (proposal.rows.length === 0) {
    await interaction.reply({
      content: `${header}\nNo attendance recorded yet, so there's no EP to propose. Record attendance (or run \`/import apply\` after the addon export), then \`/raid award-ep raid:${raidId}\`.`,
      ephemeral: true
    });
    return;
  }
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${EP_AWARD_PREFIX}approve:${raidId}`).setLabel(`Approve ${proposal.rows.length} awards`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${EP_AWARD_PREFIX}cancel:${raidId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
  await interaction.reply({ content: header, embeds: [proposalEmbed(proposal)], components: [buttons], ephemeral: true });
}

export async function handleEpAwardButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, raidId] = interaction.customId.split(":");
  if (!interaction.guild || !raidId) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "dkpOfficer")) {
    await interaction.reply({ content: "Only EPGP officers can approve EP awards.", ephemeral: true });
    return;
  }
  if (action === "cancel") {
    await interaction.update({ content: "EP award cancelled. Nothing was recorded.", embeds: [], components: [] });
    return;
  }
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const result = await applyRaidEpProposal(prisma, guild.id, raidId, interaction.user.id);
  await auditService.record({
    guildId: guild.id,
    actorId: interaction.user.id,
    action: "EPGP_TRANSACTION_CREATED",
    entityId: raidId,
    metadata: { type: "RAID_EP", created: result.created, skipped: result.skipped, totalEp: result.total }
  });
  await interaction.update({
    content: `Approved: **${result.created}** EP award(s), ${result.total} EP total.${result.skipped ? ` ${result.skipped} already had this raid's EP and were skipped.` : ""}`,
    embeds: [],
    components: []
  });
  // The raid report replaces a separate "EP awarded" line: approval is the
  // moment the raid's numbers are final.
  if (result.created > 0) {
    const posted = await postRaidReport(interaction.guild, guild.id, raidId).catch(() => false);
    if (!posted) await notify(interaction.guild, notifications.epAwarded(result.proposal.title, result.created, result.total));
  }
}
