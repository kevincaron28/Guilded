import { updateDungeonLeaderboard } from "../services/dungeon-leaderboard.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createAuditService } from "../services/audit.js";
import {
  adjustPoints, describeConfig, setDungeonMasterCount, invalidateRun, pointHistory, POINT_RULES, readConfig, setRulePoints, setTarget,
  setWeeklyRepeat, type PointRule
} from "../services/dungeon-admin.js";
import { formatDuration } from "../services/dungeon-rules.js";
import { describeEvidence, provisionalSeasonEmbed, recalibrateRoute, recalibrationEvidence } from "../services/dungeon-bracket-season.js";
import { postToLogChannel } from "../services/housekeeping.js";
import { findPlayer } from "../services/player-search.js";
import { requireGuildContext } from "./context.js";

const auditService = createAuditService(prisma);

// Officer tools for the dungeon challenge (roadmap D7). Every change is
// written to the audit log and the officer log channel.
export const dungeonAdminCommand = new SlashCommandBuilder()
  .setName("dungeon-admin")
  .setDescription("Officers: fix dungeon runs and points, change the rules.")
  .addSubcommand((sub) => sub.setName("invalidate").setDescription("Stop a run from counting and take back its points")
    .addStringOption((o) => o.setName("run").setDescription("The run (pick from the list)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why (shown in the history)").setRequired(true).setMaxLength(200)))
  .addSubcommand((sub) => sub.setName("award").setDescription("Give or take dungeon points by hand")
    .addIntegerOption((o) => o.setName("amount").setDescription("e.g. 25, or -25 to remove").setRequired(true).setMinValue(-10000).setMaxValue(10000))
    .addStringOption((o) => o.setName("reason").setDescription("Why (shown in the history)").setRequired(true).setMaxLength(200))
    .addUserOption((o) => o.setName("member").setDescription("Discord member"))
    .addStringOption((o) => o.setName("character").setDescription("Or a character name")))
  .addSubcommand((sub) => sub.setName("audit").setDescription("Point history of a member or a run")
    .addUserOption((o) => o.setName("member").setDescription("Discord member"))
    .addStringOption((o) => o.setName("character").setDescription("Or a character name"))
    .addStringOption((o) => o.setName("run").setDescription("Or one run (pick from the list)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("config").setDescription("See the point rules, or change one")
    .addStringOption((o) => o.setName("rule").setDescription("Rule to change").addChoices(...POINT_RULES.map((rule) => ({ name: rule, value: rule }))))
    .addIntegerOption((o) => o.setName("points").setDescription("New points for that rule").setMinValue(0).setMaxValue(10000))
    .addStringOption((o) => o.setName("weekly").setDescription("Share per repeat in a week, percent: e.g. 100,50,0"))
    .addIntegerOption((o) => o.setName("dungeon_master").setDescription("Dungeons needed for Dungeon Master").setMinValue(1).setMaxValue(100)))
  .addSubcommand((sub) => sub.setName("target").setDescription("Target time for a dungeon; 0 removes it")
    .addStringOption((o) => o.setName("dungeon").setDescription("Dungeon (pick from the list)").setAutocomplete(true).setRequired(true))
    .addNumberOption((o) => o.setName("minutes").setDescription("e.g. 25").setRequired(true).setMinValue(0).setMaxValue(240))
    .addIntegerOption(o => o.setName("min_level").setDescription("Minimum party level next season").setMinValue(1).setMaxValue(100))
    .addIntegerOption(o => o.setName("max_level").setDescription("Maximum party level next season").setMinValue(1).setMaxValue(100))
    .addIntegerOption(o => o.setName("difficulty").setDescription("Competitive difficulty ID next season").setMinValue(0)))
  .addSubcommand(sub => sub.setName("bracket-preview").setDescription("Preview the provisional all-level season (nothing starts)"))
  .addSubcommand(sub => sub.setName("recalibrate").setDescription("Route target from real runs; earned scores stay")
    .addStringOption(o => o.setName("route").setDescription("Route (pick from the list)").setAutocomplete(true).setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("New target; leave out to see the runs").setMinValue(5).setMaxValue(120)));

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
    const rule = interaction.options.getString("rule") as PointRule | null;
    const points = interaction.options.getInteger("points");
    const weekly = interaction.options.getString("weekly");
    const changes: string[] = [];
    if (rule !== null || points !== null) {
      if (rule === null || points === null) throw new Error("Give both a rule and its points.");
      const result = await setRulePoints(prisma, context.guildId, rule, points);
      changes.push(`${rule}: ${result.before} → ${result.after}`);
    }
    if (weekly) {
      const shares = await setWeeklyRepeat(prisma, context.guildId, weekly);
      changes.push(`weekly repeat: ${shares.map((share) => `${Math.round(share * 100)}%`).join(" → ")}`);
    }
    const master = interaction.options.getInteger("dungeon_master");
    if (master !== null) {
      const result = await setDungeonMasterCount(prisma, context.guildId, master);
      changes.push(`Dungeon Master: ${result.before} → ${result.after} dungeons`);
    }
    if (changes.length) await log(`dungeon rules changed (${changes.join("; ")})`, { changes: changes.join("; ") });
    const names = new Map((await prisma.dungeonRun.findMany({ where: { guildId: context.guildId }, distinct: ["instanceId"], select: { instanceId: true, dungeonName: true } }))
      .map((row) => [row.instanceId, row.dungeonName]));
    reply = `${changes.length ? `Changed: ${changes.join("; ")}. New runs use this; points already given stay.\n\n` : ""}${describeConfig(await readConfig(prisma, context.guildId), names)}`;
  } else if (subcommand === "target") {
    const instanceId = Number(interaction.options.getString("dungeon", true));
    if (!Number.isInteger(instanceId) || instanceId <= 0) throw new Error("Pick the dungeon from the list.");
    const minutes = interaction.options.getNumber("minutes", true);
    const min = interaction.options.getInteger("min_level"), max = interaction.options.getInteger("max_level"), difficultyId = interaction.options.getInteger("difficulty");
    const hasBand = min !== null || max !== null || difficultyId !== null;
    if (hasBand && (min === null || max === null || difficultyId === null)) throw new Error("Supply min_level, max_level and difficulty together.");
    const seconds = await setTarget(prisma, context.guildId, instanceId, minutes, hasBand ? { min: min!, max: max!, difficultyId: difficultyId! } : undefined);
    const run = await prisma.dungeonRun.findFirst({ where: { guildId: context.guildId, instanceId }, select: { dungeonName: true } });
    const name = run?.dungeonName ?? `dungeon #${instanceId}`;
    reply = (seconds === null ? `Removed the target time for ${name}.` : `Target time for ${name}: ${formatDuration(seconds)}. Clears at or under it earn the participation underTarget bonus.`)
      + " Rating targets are frozen when a season starts; this change applies to the next rating season.";
    await log(reply, { instanceId, minutes });
  } else if (subcommand === "bracket-preview") {
    await interaction.reply({ embeds: [provisionalSeasonEmbed()], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  } else if (subcommand === "recalibrate") {
    const key = interaction.options.getString("route", true);
    const minutes = interaction.options.getInteger("minutes");
    if (minutes === null) reply = describeEvidence(await recalibrationEvidence(prisma, context.guildId, key));
    else {
      const result = await recalibrateRoute(prisma, context.guildId, key, minutes);
      reply = `**${result.route.name}**: target ${formatDuration(result.beforeSec)} → ${formatDuration(result.afterSec)} for runs ending from <t:${Math.floor(result.from.getTime() / 1000)}:f>, `
        + `from ${result.times.length} real timed run(s) (median ${formatDuration(result.median!)}). Runs that ended earlier keep their score.`
        + (result.rules.provisionalTargets ? "" : " Every route is now recalibrated: the season is no longer marked provisional.");
      await log(reply, { seasonId: result.season.id, route: key, beforeSec: result.beforeSec, afterSec: result.afterSec });
    }
  } else {
    // Seasons follow the bot owner's calendar (/guilded-season); officers no longer start them.
    reply = "Dungeon seasons are set by the Guilded owner for every guild. See them with `/organize dungeon-seasons preview`.";
  }
  await interaction.reply({ content: reply.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (["award", "invalidate"].includes(subcommand) || subcommand === "recalibrate" && interaction.options.getInteger("minutes") !== null) {
    await updateDungeonLeaderboard(interaction.guild);
  }
}
