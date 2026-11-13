import { pilotGuildScope } from "../hosted-pilot.js";
import { coreContext } from "../services/core-context.js";
import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../database.js";
import { config } from "../config.js";
import { recentSnapshots } from "../services/stat-snapshots.js";
import { serverStatsCard, serverStatsEmbed } from "../services/stats-card.js";
import { scoreCardPng } from "../services/score-card.js";
import { guildStats, type GuildStats } from "../services/guild-stats.js";
import { isWeeklyReportDueAfterReset, weeklyReport, type WeeklyReport } from "../services/weekly-report.js";
import { formatDuration } from "../services/dungeon-rules.js";
import { asLang, t, type Lang } from "../i18n.js";
import { guildService, requireGuildContext } from "./context.js";
import { runDiscordJobs } from "../services/discord-jobs.js";
import { queueWeeklyWowReport } from "../services/weekly-report-delivery.js";
import { weeklyReportCard } from "../services/weekly-card.js";
import { textlessEmbed } from "../services/card-only.js";
import { personalWeeklyRecap, personalWeeklyRecapEmbed } from "../services/personal-weekly-recap.js";
import { dailyRecap, dailyRecapCard, dailyRecapEmbed, queueDailyRecaps, recapDay, recapIsEmpty } from "../services/daily-recap.js";
import { hasPermission } from "../permissions.js";
import { activityChannelId, activityPayload, updateActivityBoard } from "../services/guild-activity.js";

export const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Guild activity: raids, boss kills, loot, EP, top attendance.")
  .addBooleanOption(o => o.setName("personal").setDescription("Private weekly recap; excludes guild days/core filters")
    .setDescriptionLocalizations({ fr: "Bilan hebdomadaire privé; sans filtres jours/core" }))
  .addBooleanOption(o => o.setName("server").setDescription("Server statistics: members, activity and a class chart").setDescriptionLocalizations({ fr: "Statistiques du serveur : membres, activité, graphique des classes" }))
  .addBooleanOption(o => o.setName("recap").setDescription("Yesterday's daily recap card, privately").setDescriptionLocalizations({ fr: "Le bilan d'hier, en privé" }))
  .addBooleanOption(o => o.setName("recap-posts").setDescription("Officers: post the daily recap (default on)").setDescriptionLocalizations({ fr: "Officiers : publier le bilan quotidien (actif par défaut)" }))
  .addStringOption(o => o.setName("activity").setDescription("Guild activity ladder: dungeons, duels, battlegrounds").setDescriptionLocalizations({ fr: "Classement d'activité : donjons, duels, champs de bataille" })
    .addChoices({ name: "This week", value: "week", name_localizations: { fr: "Cette semaine" } }, { name: "Season", value: "season", name_localizations: { fr: "Saison" } }))
  .addBooleanOption(o => o.setName("activity-board").setDescription("Officers: post the guild activity ladder (default on)").setDescriptionLocalizations({ fr: "Officiers : publier le classement d'activité (actif par défaut)" }))
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
  if (interaction.options.getBoolean("personal")) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const lang = asLang((await guildService.getSettings(context.guildId))?.language);
    if (interaction.options.getInteger("days") !== null || interaction.options.getString("core") !== null) {
      await interaction.editReply({ content: lang === "fr" ? "Le bilan personnel utilise la dernière semaine complète. Retirez les filtres days/core." : "Personal recap uses the last complete week. Remove the days/core filters.", allowedMentions: { parse: [] } });
      return;
    }
    await interaction.editReply({ embeds: [personalWeeklyRecapEmbed(await personalWeeklyRecap(prisma, context.guildId, interaction.user.id), lang)], allowedMentions: { parse: [] } });
    return;
  }
  const recapPosts = interaction.options.getBoolean("recap-posts");
  if (recapPosts !== null) {
    const lang = asLang((await guildService.getSettings(context.guildId))?.language);
    if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) throw new Error(lang === "fr" ? "Réservé aux officiers." : "Officers only.");
    // Turning it back on resumes from today: the days in between are not posted late.
    await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { dailyRecapEnabled: recapPosts, ...(recapPosts ? { dailyRecapLastDay: recapDay(new Date(), (await guildService.getSettings(context.guildId))?.timezone ?? "America/Toronto") } : {}) } });
    await interaction.reply({ content: recapPosts
      ? lang === "fr" ? "🗓️ Le bilan quotidien est publié chaque jour où il se passe quelque chose (salon du rapport hebdomadaire, sinon des annonces)." : "🗓️ The daily recap is posted every day something happens (weekly-report channel, else announcements)."
      : lang === "fr" ? "Le bilan quotidien n'est plus publié. /stats recap:true le montre toujours en privé." : "The daily recap is no longer posted. /stats recap:true still shows it privately.",
      flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const activityBoard = interaction.options.getBoolean("activity-board");
  if (activityBoard !== null) {
    const settings = await guildService.getSettings(context.guildId);
    const lang = asLang(settings?.language);
    if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) throw new Error(lang === "fr" ? "Réservé aux officiers." : "Officers only.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { activityBoardEnabled: activityBoard } });
    const channelId = settings ? activityChannelId(settings) : null;
    const posted = activityBoard && channelId ? await updateActivityBoard(interaction.guild) : false;
    await interaction.editReply({ content: !activityBoard
      ? lang === "fr" ? "Classement d'activité désactivé. Le message existant reste; supprimez-le si vous le souhaitez. /stats activity le montre toujours en privé." : "Guild activity ladder off. The existing message stays; delete it if you wish. /stats activity still shows it privately."
      : !channelId ? lang === "fr" ? "Activé. Il apparaîtra quand le salon du classement des donjons existera (/setup)." : "On. It appears once the dungeon leaderboard channel exists (/setup)."
      : lang === "fr" ? `🏅 Classement d'activité ${posted ? "publié" : "activé; il apparaîtra au prochain rafraîchissement"} dans <#${channelId}>. Il est modifié sur place toutes les 30 minutes.` : `🏅 Guild activity ladder ${posted ? "posted" : "on; it appears on the next refresh"} in <#${channelId}>. It is edited in place every 30 minutes.`,
      allowedMentions: { parse: [] } });
    return;
  }
  const activity = interaction.options.getString("activity");
  if (activity === "week" || activity === "season") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const settings = await guildService.getSettings(context.guildId);
    const guild = await prisma.guild.findUnique({ where: { id: context.guildId }, select: { gameEdition: true } });
    // Private view: no rank snapshot, so looking at it never moves the public board's arrows.
    await interaction.editReply(await activityPayload(context.guildId, guild?.gameEdition ?? "forever", asLang(settings?.language), activity, false));
    return;
  }
  if (interaction.options.getBoolean("recap")) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const settings = await guildService.getSettings(context.guildId);
    const lang = asLang(settings?.language), timezone = settings?.timezone ?? "America/Toronto";
    const recap = await dailyRecap(prisma, context.guildId, recapDay(new Date(), timezone), timezone, { race: settings?.raceBoardEnabled ?? true });
    if (recapIsEmpty(recap)) {
      await interaction.editReply({ content: lang === "fr" ? "Rien à raconter pour hier : aucun niveau, donjon ni duel enregistré." : "Nothing to recap for yesterday: no levels, dungeons or duels were recorded.", allowedMentions: { parse: [] } });
      return;
    }
    const embed = dailyRecapEmbed(recap, lang);
    const png = await scoreCardPng(dailyRecapCard(recap, lang, interaction.guild?.name ?? "Guilded")).catch(() => null);
    if (png) embed.setImage("attachment://recap.png");
    await interaction.editReply({ embeds: [embed], ...(png ? { files: [new AttachmentBuilder(png, { name: "recap.png" })] } : {}), allowedMentions: { parse: [] } });
    return;
  }
  if (interaction.options.getBoolean("server")) {
    await interaction.deferReply();
    const lang = asLang((await guildService.getSettings(context.guildId))?.language);
    const rows = await recentSnapshots(prisma, context.guildId, 30);
    const card = serverStatsCard(rows, interaction.guild?.name ?? "Guilded", lang);
    const embed = serverStatsEmbed(rows, interaction.guild?.name ?? "Guilded", lang);
    if (!card || !embed) {
      await interaction.editReply({ content: lang === "fr" ? "Pas encore de statistiques : le premier relevé quotidien arrive bientôt (ou un officier les a désactivées)." : "No statistics yet: the first daily snapshot is written soon (or an officer turned them off).", allowedMentions: { parse: [] } });
      return;
    }
    const png = await scoreCardPng(card).catch(() => null);
    if (png) embed.setImage("attachment://server-stats.png");
    await interaction.editReply({ embeds: [embed], ...(png ? { files: [new AttachmentBuilder(png, { name: "server-stats.png" })] } : {}), allowedMentions: { parse: [] } });
    return;
  }
  const days = interaction.options.getInteger("days") ?? 7;
  const core = await coreContext(prisma, context.guildId, interaction.channelId, interaction.options.getString("core"));
  const stats = await guildStats(prisma, context.guildId, new Date(Date.now() - days * 86_400_000), undefined, core?.id);
  const lang = asLang((await guildService.getSettings(context.guildId))?.language);
  await interaction.reply({ embeds: [statsEmbed(stats, `${core ? core.name + " · " : ""}${t(lang, "stats.titleDays", { days })}`, lang)], allowedMentions: { parse: [] } });
}

// The weekly report as embeds: the guild's week (against the week before) with the players of
// the week, then each raid core, then the dungeon week. Sections with nothing in them are left out.
// leaderboardUrl: the guild's public leaderboard page, when it shares runs and the bot has a site.
export function weeklyReportEmbeds(report: WeeklyReport, lang: Lang = "en", leaderboardUrl?: string): EmbedBuilder[] {
  const date = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:D>`;
  const main = statsEmbed(report.guild, t(lang, "stats.titleWeekly"), lang, report.previous)
    .setDescription(t(lang, "weekly.week", { start: date(report.weekStart), end: date(report.weekEnd) }));
  // Membership and applications span the whole Discord guild, unlike WoW raids and dungeons.
  if (!report.guild.coreId) main.spliceFields(4, 2);
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
    if (d.marathon) dungeons.addFields({ name: lang === "fr" ? "🔁 Marathon de donjons" : "🔁 Dungeon marathon", value: lang === "fr" ? `${d.marathon.name} : ${d.marathon.runs} donjons terminés` : `${d.marathon.name}: ${d.marathon.runs} completed runs` });
    if (d.records.length) dungeons.addFields({ name: t(lang, "weekly.records"), value: d.records.slice(0, 15).join("\n").slice(0, 1024) });
    if (d.firsts.length) dungeons.addFields({ name: t(lang, "weekly.firsts"), value: d.firsts.slice(0, 15).join("\n").slice(0, 1024) });
    if (leaderboardUrl) dungeons.setURL(leaderboardUrl).addFields({ name: "​", value: t(lang, "weekly.leaderboard", { url: leaderboardUrl }) });
    embeds.push(dungeons);
  }
  if (report.guild.raids === 0 && d.runs === 0 && report.guild.lootCount === 0) main.addFields({ name: "\u200b", value: t(lang, "weekly.nothing") });
  return embeds;
}

// 9.3: the card carries the week's headline and players; what it cannot carry (EP, loot and GP, most raids, most loot) stays as text.
// A week with nothing in it has no card: the text says so.
export function weeklyCardExtra(report: WeeklyReport, lang: Lang, embeds: EmbedBuilder[]): Record<string, unknown> {
  if (report.guild.raids === 0 && report.dungeons.runs === 0 && report.guild.lootCount === 0) return {};
  const details = EmbedBuilder.from(embeds[0]!.toJSON()).setTitle(null).setDescription(null).setFields(
    (embeds[0]!.data.fields ?? []).filter((field, index) => index > 1 && field.name !== t(lang, "weekly.players")));
  return { card: weeklyReportCard(report, lang), cardOnly: { embeds: [textlessEmbed(0xd4af37), ...(details.data.fields?.length ? [details.toJSON()] : []), ...embeds.slice(1).map(embed => embed.toJSON())] } };
}

// Called hourly: the daily recap of every server whose day rolled over (one post per day, quiet days post nothing).
export async function runDailyRecaps(client: Client, now = new Date()): Promise<number> {
  const queued = await queueDailyRecaps(prisma, now, { scope: pilotGuildScope, onError: error => console.error("Daily recap failed", error) });
  if (queued) await runDiscordJobs(client);
  return queued;
}

// Called hourly: the WoW report and its retryable delivery commit together. The guild lock
// prevents concurrent ticks from queuing the same week twice.
export async function runWeeklyReports(client: Client, now = new Date()): Promise<number> {
  const configured = await prisma.guildSettings.findMany({
    where: { ...pilotGuildScope, weeklyReportEnabled: true, OR: [{ weeklyReportChannelId: { not: null } }, { notifyChannelId: { not: null } }] },
    include: { guild: true }
  });
  let posted = 0;
  for (const settings of configured) {
    if (!isWeeklyReportDueAfterReset({ enabled: settings.weeklyReportEnabled, lastAt: settings.weeklyReportLastAt, now })) continue;
    try {
      const report = await weeklyReport(prisma, settings.guildId, now);
      const lang = asLang(settings.language);
      const leaderboardUrl = settings.publicDungeonRuns && config.PUBLIC_SITE_URL
        ? `${new URL(config.PUBLIC_SITE_URL).origin}/leaderboards/guild/${encodeURIComponent(settings.guildId)}?lang=${lang}` : undefined;
      const embeds = weeklyReportEmbeds(report, lang, leaderboardUrl);
      const queued = await queueWeeklyWowReport(prisma, settings.guildId, report.weekEnd, now,
        JSON.parse(JSON.stringify({ embeds: embeds.map(embed => embed.toJSON()) })),
        // 9.3: the card replaces the first embed (the headline); the cores and dungeon embeds stay as text under it.
        JSON.parse(JSON.stringify(weeklyCardExtra(report, lang, embeds))));
      if (queued) posted += 1;
    } catch (error) {
      console.error(`Weekly report failed for guild ${settings.guild.discordId}`, error);
    }
  }
  if (posted) await runDiscordJobs(client);
  return posted;
}
