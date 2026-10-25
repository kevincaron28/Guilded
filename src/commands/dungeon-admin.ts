import { updateDungeonLeaderboard } from "../services/dungeon-leaderboard.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createAuditService } from "../services/audit.js";
import { adjustPoints, describeConfig, invalidateRun, pointHistory } from "../services/dungeon-admin.js";
import { formatDuration, sharedDungeonConfig } from "../services/dungeon-rules.js";
import { describeEvidence, provisionalSeasonEmbed, recalibrationEvidence } from "../services/dungeon-bracket-season.js";
import { postToLogChannel } from "../services/housekeeping.js";
import { findPlayer } from "../services/player-search.js";
import { requireGuildContext } from "./context.js";

const auditService = createAuditService(prisma);

// Officer tools for the dungeon challenge (roadmap D7). Every change is
// written to the audit log and the officer log channel.
export const dungeonAdminCommand = new SlashCommandBuilder()
  .setName("dungeon-admin")
  .setDescription("Guild-only dungeon corrections and rewards; public scoring is fixed.")
  .addSubcommand((sub) => sub.setName("invalidate").setDescription("Stop a run from counting and take back its points")
    .addStringOption((o) => o.setName("run").setDescription("The run (pick from the list)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why (shown in the history)").setRequired(true).setMaxLength(200)))
  .addSubcommand((sub) => sub.setName("award").setDescription("Adjust guild participation points; public scores unchanged")
    .addIntegerOption((o) => o.setName("amount").setDescription("e.g. 25, or -25 to remove").setRequired(true).setMinValue(-10000).setMaxValue(10000))
    .addStringOption((o) => o.setName("reason").setDescription("Why (shown in the history)").setRequired(true).setMaxLength(200))
    .addUserOption((o) => o.setName("member").setDescription("Discord member"))
    .addStringOption((o) => o.setName("character").setDescription("Or a character name")))
  .addSubcommand((sub) => sub.setName("audit").setDescription("Point history of a member or a run")
    .addUserOption((o) => o.setName("member").setDescription("Discord member"))
    .addStringOption((o) => o.setName("character").setDescription("Or a character name"))
    .addStringOption((o) => o.setName("run").setDescription("Or one run (pick from the list)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("config").setDescription("View the fixed dungeon participation rules for all guilds"))
  .addSubcommand(sub => sub.setName("bracket-preview").setDescription("Preview shared season targets (read only)"))
  .addSubcommand(sub => sub.setName("recalibrate").setDescription("Review timed-run evidence for future shared rules (read only)")
    .addStringOption(o => o.setName("route").setDescription("Route (pick from the list)").setAutocomplete(true).setRequired(true)));

async function memberFromOptions(interaction: ChatInputCommandInteraction, guildId: string) {
  const character = interaction.options.getString("character");
  if (character) {
    const found = await findPlayer(prisma, guildId, character);
    if (!found) throw new Error(`No linked character matches "${character}".`);
    return found.member;
  }
  const user = interaction.options.getUser("member");
  if (!user) return null;
  const member = await prisma.member.findFirst({ where: { guildId, discordUserId: user.id } });
  if (!member) throw new Error(`${user.username} is not in the bot yet (they need /character add).`);
  return member;
}

export async function executeDungeonAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only officers can use /officer dungeon.", flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  // Reject cached pre-lock commands as well as hiding their controls in registration.
  if (subcommand === "target"
    || subcommand === "config" && ["rule", "points", "weekly", "dungeon_master"].some(name => interaction.options.get(name) !== null)
    || subcommand === "recalibrate" && interaction.options.get("minutes") !== null) {
    await interaction.reply({ content: "Dungeon scoring settings are locked for all guilds. Season targets, level bands and penalties are shared and frozen. Changes wait for a future shared season; existing scores and history are preserved.", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const actor = interaction.user.id;
  const log = async (summary: string, metadata: Record<string, string | number | null>) => {
    await auditService.record({ guildId: context.guildId, actorId: actor, action: "DUNGEON_ADMIN", metadata: { action: subcommand, ...metadata } });
    if (interaction.guild) await postToLogChannel(interaction.guild, `🏰 ${interaction.user.username}: ${summary}`);
  };
  let reply: string;

  if (subcommand === "invalidate") {
    const reason = interaction.options.getString("reason", true);
    const result = await invalidateRun(prisma, context.guildId, interaction.options.getString("run", true), reason, actor);
    const time = result.run.durationSec !== null ? ` (${formatDuration(result.run.durationSec)})` : "";
    reply = `${result.run.dungeonName}${time} no longer counts. ${result.reversed} point(s) taken back from ${result.players} player(s)`
      + `${result.achievementsRevoked ? `, ${result.achievementsRevoked} achievement(s) it earned removed` : ""}. Records and leaderboards update by themselves.`;
    await log(`invalidated ${result.run.dungeonName}${time}: ${reason}`, { runRef: result.run.runRef, reason, reversed: result.reversed });
  } else if (subcommand === "award") {
    const member = await memberFromOptions(interaction, context.guildId);
    if (!member) throw new Error("Pick a member or type a character name.");
    const amount = interaction.options.getInteger("amount", true);
    const reason = interaction.options.getString("reason", true);
    await adjustPoints(prisma, context.guildId, member.id, amount, reason, actor);
    reply = `${amount > 0 ? "Gave" : "Took"} ${Math.abs(amount)} dungeon point(s) ${amount > 0 ? "to" : "from"} ${member.displayName}: ${reason}`;
    await log(reply, { memberId: member.id, amount, reason });
  } else if (subcommand === "audit") {
    const member = await memberFromOptions(interaction, context.guildId);
    const runRef = interaction.options.getString("run");
    const rows = await pointHistory(prisma, context.guildId, { ...(member ? { memberId: member.id } : {}), ...(runRef ? { runRef } : {}) });
    reply = rows.length
      ? rows.map((row) => {
        const by = row.source.startsWith("rule:") ? "auto" : `<@${row.createdBy}>`;
        return `<t:${Math.floor(row.createdAt.getTime() / 1000)}:d> **${row.member.displayName}** ${row.amount > 0 ? "+" : ""}${row.amount} — ${row.reason} · ${row.source} · ${by}`;
      }).join("\n")
      : "No dungeon points recorded for that yet.";
  } else if (subcommand === "config") {
    reply = `Dungeon scoring settings are locked for all guilds. These shared participation rules apply to new awards; existing points stay. Season targets, level bands and penalties are shared and frozen. See /dungeon rules for the active season.\n\n${describeConfig(sharedDungeonConfig(), new Map())}`;
  } else if (subcommand === "bracket-preview") {
    await interaction.reply({ embeds: [provisionalSeasonEmbed()], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  } else if (subcommand === "recalibrate") {
    const key = interaction.options.getString("route", true);
    reply = describeEvidence(await recalibrationEvidence(prisma, context.guildId, key));
  } else {
    // Seasons follow the bot owner's calendar (/guilded-season); officers no longer start them.
    reply = "Dungeon seasons are set by the Guilded owner for every guild. See them with `/organize dungeon-seasons preview`.";
  }
  await interaction.reply({ content: reply.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (["award", "invalidate"].includes(subcommand)) {
    await updateDungeonLeaderboard(interaction.guild);
  }
}
