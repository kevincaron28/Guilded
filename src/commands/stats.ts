import { coreContext } from "../services/core-context.js";
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../database.js";
import { guildStats, type GuildStats } from "../services/guild-stats.js";
import { isWeeklyReportDueAfterReset, weeklyReport, type WeeklyReport } from "../services/weekly-report.js";
import { formatDuration } from "../services/dungeon-rules.js";
import { asLang, t, type Lang } from "../i18n.js";
import { guildService, requireGuildContext } from "./context.js";

export const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Guild activity: raids, boss kills, loot, EP, top attendance.")
  .addIntegerOption((o) => o.setName("days").setDescription("How far back (default 7)").setMinValue(1).setMaxValue(365))
  .addStringOption(o => o.setName("core").setDescription("Raid core (defaults to this channel)").setAutocomplete(true));

// "12 (▲3)": a number and how it moved against the week before (none when there is no week before).
export function withDelta(value: number, previous?: number): string {
  if (previous === undefined || previous === value) return String(value);
  return `${value} (${value > previous ? "▲" : "▼"}${Math.abs(value - previous)})`;
}

export function statsEmbed(stats: GuildStats, title: string, lang: Lang = "en", previous?: GuildStats): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(t(lang, "stats.since", { date: `<t:${Math.floor(stats.since.getTime() / 1000)}:D>` }))
    .addFields(
      { name: t(lang, "stats.raids"), value: t(lang, "stats.raidsValue", { count: withDelta(stats.raids, previous?.raids), avg: stats.averageRaiders }), inline: true },
      { name: t(lang, "stats.kills"), value: withDelta(stats.bossKills, previous?.bossKills), inline: true },
      { name: t(lang, "stats.ep"), value: withDelta(stats.epAwarded, previous?.epAwarded), inline: true },
      { name: t(lang, "stats.loot"), value: `${withDelta(stats.lootCount, previous?.lootCount)} item(s), ${stats.gpSpent} GP`, inline: true },
      { name: t(lang, "stats.newMembers"), value: withDelta(stats.newMembers, previous?.newMembers), inline: true },
      { name: t(lang, "stats.applications"), value: withDelta(stats.applications, previous?.applications), inline: true }
    );
  if (stats.coreId) embed.spliceFields(4, 2);
  if (stats.topAttendance.length) {
    embed.addFields({ name: t(lang, "stats.mostRaids"), value: stats.topAttendance.map((row) => `${row.name} (${row.raids})`).join(", ").slice(0, 1000) });
  }
  if (stats.topLoot.length) {
    embed.addFields({ name: t(lang, "stats.mostLoot"), value: stats.topLoot.map((row) => `${row.name}: ${row.items} item(s), ${row.gp} GP`).join("\n").slice(0, 1000) });
  }
  return embed;
}

export async function executeStats(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const days = interaction.options.getInteger("days") ?? 7;
  const core = await coreContext(prisma, context.guildId, interaction.channelId, interaction.options.getString("core"));
  const stats = await guildStats(prisma, context.guildId, new Date(Date.now() - days * 86_400_000), undefined, core?.id);
  const lang = asLang((await guildService.getSettings(context.guildId))?.language);
  await interaction.reply({ embeds: [statsEmbed(stats, `${core ? core.name + " · " : ""}${t(lang, "stats.titleDays", { days })}`, lang)], allowedMentions: { parse: [] } });
}

// The weekly report as embeds: the guild's week (against the week before) with the players of
// the week, then each raid core, then the dungeon week. Sections with nothing in them are left out.
export function weeklyReportEmbeds(report: WeeklyReport, lang: Lang = "en"): EmbedBuilder[] {
  const date = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:D>`;
  const main = statsEmbed(report.guild, t(lang, "stats.titleWeekly"), lang, report.previous)
    .setDescription(t(lang, "weekly.week", { start: date(report.weekStart), end: date(report.weekEnd) }));
  const players = [
    report.raiderOfWeek ? t(lang, "weekly.raider", { name: report.raiderOfWeek.name, ep: report.raiderOfWeek.ep, raids: report.raiderOfWeek.raids }) : "",
    report.dungeonHero ? t(lang, "weekly.hero", { name: report.dungeonHero.name, points: report.dungeonHero.points }) : ""
  ].filter(Boolean);
  if (players.length) main.addFields({ name: t(lang, "weekly.players"), value: players.join("\n") });
  const embeds = [main];

  if (report.cores.length) {
    const cores = new EmbedBuilder().setTitle(t(lang, "weekly.cores")).setColor(0xd4af37);
    for (const core of report.cores.slice(0, 25)) {
      const lines = [t(lang, "weekly.coreLine", {
        raids: core.raids, kills: core.bossKills, attendance: core.attendancePct === null ? "—" : `${core.attendancePct}%`, loot: core.loot, gp: core.gp
      })];
      if (core.perfect.length) lines.push(t(lang, "weekly.perfect", { names: core.perfect.join(", ") }));
      cores.addFields({ name: core.name, value: lines.join("\n").slice(0, 1024) });
    }
    embeds.push(cores);
  }

  const d = report.dungeons;
  if (d.runs > 0) {
    const dungeons = new EmbedBuilder().setTitle(t(lang, "weekly.dungeons")).setColor(0x5865f2)
      .setDescription(t(lang, "weekly.dungeonRuns", { completed: d.completed, runs: d.runs }));
    if (d.fastest.length) dungeons.addFields({ name: t(lang, "weekly.fastest"), value: d.fastest.slice(0, 10).map((row) => `${row.dungeon}: ${formatDuration(row.durationSec)} (${row.players.join(", ")})`).join("\n").slice(0, 1024) });
    if (d.topPoints.length) dungeons.addFields({ name: t(lang, "weekly.topPoints"), value: d.topPoints.map((row, i) => `${["🥇", "🥈", "🥉"][i]} ${row.name}: ${row.points}`).join("\n") });
    if (d.records.length) dungeons.addFields({ name: t(lang, "weekly.records"), value: d.records.slice(0, 15).join("\n").slice(0, 1024) });
    if (d.firsts.length) dungeons.addFields({ name: t(lang, "weekly.firsts"), value: d.firsts.slice(0, 15).join("\n").slice(0, 1024) });
    embeds.push(dungeons);
  }
  if (report.guild.raids === 0 && d.runs === 0 && report.guild.lootCount === 0) main.addFields({ name: "\u200b", value: t(lang, "weekly.nothing") });
  return embeds;
}

// Called hourly from main.ts: posts the weekly report to the notify channel for guilds that
// turned it on (/setup config weekly-report), once per weekly reset (Tuesday 15:00 UTC), about
// the week that just ended. Marks the guild first so a failed post can't repeat every hour.
export async function runWeeklyReports(client: Client, now = new Date()): Promise<number> {
  const configured = await prisma.guildSettings.findMany({
    where: { weeklyReportEnabled: true, notifyChannelId: { not: null } },
    include: { guild: true }
  });
  let posted = 0;
  for (const settings of configured) {
    if (!isWeeklyReportDueAfterReset({ enabled: settings.weeklyReportEnabled, lastAt: settings.weeklyReportLastAt, now })) continue;
    await prisma.guildSettings.update({ where: { id: settings.id }, data: { weeklyReportLastAt: now } });
    try {
      const report = await weeklyReport(prisma, settings.guildId, now);
      const discordGuild = await client.guilds.fetch(settings.guild.discordId);
      const channel = await discordGuild.channels.fetch(settings.notifyChannelId ?? "");
      if (!channel?.isTextBased()) continue;
      const lang = asLang(settings.language);
      await channel.send({ embeds: weeklyReportEmbeds(report, lang), allowedMentions: { parse: [] } });
      posted += 1;
    } catch (error) {
      console.error(`Weekly report failed for guild ${settings.guild.discordId}`, error);
    }
  }
  return posted;
}
