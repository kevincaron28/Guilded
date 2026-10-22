import { EmbedBuilder, SlashCommandBuilder, escapeMarkdown, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { config } from "../config.js";
import { asLang, t, tx, type Lang } from "../i18n.js";
import { v2Reply, type V2Link } from "../services/components-v2.js";
import { achievementName } from "../services/dungeon-achievements.js";
import { ensureDungeonSignupGuide } from "../services/dungeon-guide.js";
import { dungeonConfig, formatDuration } from "../services/dungeon-rules.js";
import { dungeonScoringGuide } from "../services/dungeon-scoring-guide.js";
import { novemberCatalogEmbeds } from "../services/dungeon-november-catalog.js";
import { bracketPlanEmbed } from "../services/dungeon-bracket-plan.js";
import {
  activeSeasonOrNull, difficultyName, formatLeaderboard, leaderboard, playerSummary, recentRuns, records,
  type Period, type RecordRow, type RunRow
} from "../services/dungeon-stats.js";
import { findPlayer } from "../services/player-search.js";
import { executeDungeonGroup } from "./dungeon-group.js";
import { openGroupAlerts } from "./group-alerts.js";
import { guildService, requireGuildContext } from "./context.js";
import { seasonArchive, seasonRows } from "../services/season-archive.js";
import { weekSeason, weekWindow } from "../services/dungeon-periods.js";
import { defaultBracket, dungeonRating, hasDungeonRating, ratingEmbed, type RatingRow } from "../services/dungeon-rating.js";

// Dungeon challenge views (roadmap D5). Points come from runs the addon
// recorded and an officer imported (/import apply).
export const dungeonCommand = new SlashCommandBuilder()
  .setName("dungeon")
  .setDescription("Dungeon challenge: points leaderboard, records, player stats, recent runs.")
  .addSubcommand(sub => sub.setName("catalog").setDescription("November dungeon plan; separate from active season rules")
    .setDescriptionLocalizations({ fr: "Catalogue prévu pour novembre; distinct des règles actives" }))
  .addSubcommand(sub => sub.setName("rules").setDescription("How dungeon rating and participation points are calculated")
    .setDescriptionLocalizations({ fr: "Comment la cote et les points de participation sont calculés" }))
  .addSubcommand((sub) => sub.setName("leaderboard").setDescription("Season rating or participation points")
    .addStringOption(o => o.setName("metric").setDescription("Default: season rating; other periods use participation").addChoices({name:"Rating",value:"rating"},{name:"Participation",value:"participation"}))
    .addStringOption((o) => o.setName("period").setDescription("Default: this season").addChoices(
      { name: "This week", value: "week" }, { name: "This month", value: "month" }, { name: "This season", value: "season" }, { name: "All time", value: "all" }))
    .addStringOption((o) => o.setName("season").setDescription("Browse a past season (overrides period)").setAutocomplete(true))
    .addStringOption((o) => o.setName("dungeon").setDescription("Only one dungeon (pick from the list)").setAutocomplete(true))
    .addStringOption((o) => o.setName("bracket").setDescription("Level bracket, for all-level seasons (default: yours)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("records").setDescription("Fastest clears: every dungeon, or the top times of one")
    .addStringOption((o) => o.setName("dungeon").setDescription("One dungeon (pick from the list)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("player").setDescription("A player's points, best times and recent runs (default: you)")
    .addUserOption((o) => o.setName("member").setDescription("Discord member"))
    .addStringOption((o) => o.setName("character").setDescription("Or a character name")))
  .addSubcommand((sub) => sub.setName("history").setDescription("The most recent dungeon runs")
    .addUserOption((o) => o.setName("member").setDescription("Only runs with this member")))
  .addSubcommand((sub) => sub.setName("season").setDescription("The current season and its leaders")
    .addStringOption((o) => o.setName("bracket").setDescription("Level bracket, for all-level seasons (default: yours)").setAutocomplete(true)))
  .addSubcommand(sub => sub.setName("archive").setDescription("All seasons, including older ones")
    .addIntegerOption(option => option.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(100000)))
  .addSubcommand(sub => sub.setName("hall-of-fame").setDescription("Past season champions")
    .addIntegerOption(option => option.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(100000)))
  .addSubcommand((sub) => sub.setName("guide").setDescription("Post or repair the pinned dungeon signup button")
    .setDescriptionLocalizations({ fr: "Publier ou réparer le bouton épinglé pour les inscriptions aux donjons" }))
  .addSubcommand((sub) => sub.setName("group").setDescription("Form a dungeon group: a signup post with buttons and a temporary voice channel")
    .addStringOption((o) => o.setName("title").setDescription("e.g. Deadmines, need tank + healer").setMinLength(3).setMaxLength(80).setRequired(true)))
  .addSubcommand((sub) => sub.setName("alerts").setDescription("Your group alerts: get pinged for groups your level and roles fit")
    .setDescriptionLocalizations({ fr: "Vos alertes de groupe : être mentionné pour les groupes à votre niveau et vos rôles" }));

function dungeonOption(interaction: ChatInputCommandInteraction): number | null {
  const raw = interaction.options.getString("dungeon");
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Pick the dungeon from the list.");
  return id;
}

const label = (row: { dungeonName: string; difficultyId: number }) => {
  const difficulty = difficultyName(row.difficultyId);
  return difficulty ? `${row.dungeonName} (${difficulty})` : row.dungeonName;
};
// All-level seasons: the bracket asked for, else the viewer's own best one, else every bracket.
const bracketChoice = (interaction: ChatInputCommandInteraction, rows: RatingRow[], memberId: string | null) =>
  interaction.options.getString("bracket") ?? defaultBracket(rows, memberId);
const when = (date: Date | null) => (date ? ` · <t:${Math.floor(date.getTime() / 1000)}:d>` : "");

export function recordLine(row: RecordRow, index?: number): string {
  const prefix = index === undefined ? "•" : `${index + 1}.`;
  return `${prefix} **${label(row)}** — ${formatDuration(row.durationSec)} — ${row.players.join(", ")}${when(row.endedAt)}`;
}

export function runLine(run: RunRow, lang: Lang): string {
  const state = t(lang, `dungeon.state.${run.state}` as "dungeon.state.COMPLETED");
  const time = run.durationSec !== null && run.state === "COMPLETED" ? ` ${formatDuration(run.durationSec)}` : "";
  const tracked = run.players.filter((player) => player.deaths !== null);
  const deaths = tracked.length ? ` · ${t(lang, "dungeon.deaths", { count: tracked.reduce((sum, player) => sum + (player.deaths ?? 0), 0) })}` : "";
  const invalid = run.valid ? "" : ` · ❌ ${t(lang, "dungeon.notCounted")}${run.invalidReason ? ` (${run.invalidReason})` : ""}`;
  return `• **${label(run)}** — ${state ?? run.state}${time}${deaths}${invalid}${when(run.endedAt)}\n  ${run.players.map((player) => player.character).join(", ")}`;
}

async function resolveMember(interaction: ChatInputCommandInteraction, guildId: string, fallbackMemberId: string | null) {
  const user = interaction.options.getUser("member");
  const character = interaction.options.getString("character");
  if (character) {
    const found = await findPlayer(prisma, guildId, character);
    if (!found) throw new Error(`No linked character matches "${character}".`);
    return found.member;
  }
  if (user) {
    const member = await prisma.member.findFirst({ where: { guildId, discordUserId: user.id } });
    if (!member) throw new Error(`${user.username} has no dungeon runs yet.`);
    return member;
  }
  return fallbackMemberId ? prisma.member.findUnique({ where: { id: fallbackMemberId } }) : null;
}

export async function executeDungeon(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const lang = asLang((await guildService.getSettings(context.guildId))?.language);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "catalog") {
    await interaction.reply({ embeds: novemberCatalogEmbeds(lang), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    // Discord's 6,000-character budget is per message: the all-level plan goes in its own.
    await interaction.followUp({ embeds: [bracketPlanEmbed(lang)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "rules") {
    const settings = await prisma.guildSettings.findUnique({ where: { guildId: context.guildId }, select: { dungeonConfig: true } });
    const season = await prisma.dungeonSeason.findFirst({ where: { guildId: context.guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    await interaction.reply({ embeds: [dungeonScoringGuide(dungeonConfig(settings?.dungeonConfig), lang, season?.ratingRules)], flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "archive" || subcommand === "hall-of-fame") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const archive = await seasonArchive(prisma, context.guildId, interaction.options.getInteger("page") ?? 1, subcommand === "hall-of-fame");
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xd4a017)
      .setTitle(subcommand === "archive" ? lang === "fr" ? "Saisons" : "Season archive" : lang === "fr" ? "Temple de la renommée" : "Hall of Fame")
      .setDescription(archive.text).setFooter({ text: `${archive.current} / ${archive.pages}` })], allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "guide") {
    const settings = await guildService.getSettings(context.guildId);
    const channel = settings?.dungeonSignupChannelId
      ? await interaction.guild?.channels.fetch(settings.dungeonSignupChannelId).catch(() => null)
      : null;
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error("Set a dungeon signups channel with /config channel, then run /dungeon guide again.");
    }
    await ensureDungeonSignupGuide(channel, lang);
    await interaction.reply({ content: tx(lang, "Pinned dungeon signup guide is ready in <#{id}>.", { id: channel.id }), flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "group") {
    await executeDungeonGroup(interaction);
    return;
  }
  if (subcommand === "alerts") {
    await openGroupAlerts(interaction);
    return;
  }
  const embed = new EmbedBuilder().setColor(0xd4a017);

  if (subcommand === "leaderboard") {
    const seasonId = interaction.options.getString("season") ?? undefined;
    // Seasons are monthly: "month" is the season (dungeon-periods.ts).
    const chosen = interaction.options.getString("period");
    const period = (seasonId || chosen === "month" ? "season" : chosen ?? "season") as Period;
    const instanceId = dungeonOption(interaction);
    const season = seasonId ? await prisma.dungeonSeason.findFirst({ where: { guildId: context.guildId, id: seasonId } }) : period !== "all" ? await activeSeasonOrNull(prisma, context.guildId) : null;
    if (seasonId && !season) throw new Error("That season does not belong to this guild.");
    const metric = interaction.options.getString("metric");
    if (metric === "rating" && period === "all") throw new Error(lang === "fr" ? "La cote se consulte par semaine ou par saison." : "Rating is weekly or per season; choose another period.");
    // Weekly rating: the active season's runs since the weekly reset, with the season's rules.
    if (period === "week" && season && hasDungeonRating(season.ratingRules) && metric !== "participation") {
      const week = weekSeason(season);
      const rows = week ? await dungeonRating(prisma, context.guildId, week, instanceId) : [];
      const since = `<t:${Math.floor(weekWindow(new Date()).start.getTime() / 1000)}:f>`;
      await interaction.reply(v2Reply(ratingEmbed(rows, `${season.name} · ${lang === "fr" ? "cette semaine" : "this week"}`, lang, season.ratingRules, bracketChoice(interaction, rows, context.memberId)),
        { lead: lang === "fr" ? `Depuis la réinitialisation hebdomadaire (${since}).` : `Since the weekly reset (${since}).`, link: await publicBoardLink(context.guildId, lang) }));
      return;
    }
    if (metric === "rating" && !hasDungeonRating(season?.ratingRules)) throw new Error(lang === "fr" ? "Cette saison utilise les anciens points de participation." : "This season uses legacy participation points.");
    if (period === "season" && season && hasDungeonRating(season.ratingRules) && metric !== "participation") {
      const rows = await dungeonRating(prisma, context.guildId, season, instanceId);
      await interaction.reply(v2Reply(ratingEmbed(rows, season.name, lang, season.ratingRules, bracketChoice(interaction, rows, context.memberId)), { link: await publicBoardLink(context.guildId, lang) }));
      return;
    }
    const rows = season?.status === "ENDED" && instanceId === null ? await seasonRows(prisma, context.guildId, { ...season, ratingRules: null }) : await leaderboard(prisma, context.guildId, period, instanceId, 10, new Date(), seasonId);
    embed.setTitle(period === "season"
      ? t(lang, "dungeon.board.season", { season: season?.name ?? "Season 1" })
      : t(lang, period === "week" ? "dungeon.board.week" : "dungeon.board.all"));
    if (instanceId !== null) {
      const run = await prisma.dungeonRun.findFirst({ where: { guildId: context.guildId, instanceId }, select: { dungeonName: true } });
      embed.setFooter({ text: t(lang, "dungeon.board.dungeon", { dungeon: run?.dungeonName ?? String(instanceId) }) });
    }
    embed.setDescription(rows.length ? formatLeaderboard(rows) : t(lang, "dungeon.board.empty"));
    if (season && hasDungeonRating(season.ratingRules)) embed.setTitle(lang === "fr" ? "Points de participation" : "Participation points");
  } else if (subcommand === "records") {
    const instanceId = dungeonOption(interaction);
    const rows = await records(prisma, context.guildId, instanceId);
    embed.setTitle(instanceId !== null && rows[0] ? t(lang, "dungeon.records.one", { dungeon: rows[0].dungeonName }) : t(lang, "dungeon.records.title"));
    embed.setDescription(rows.length
      ? rows.map((row, index) => recordLine(row, instanceId !== null ? index : undefined)).join("\n").slice(0, 4000)
      : t(lang, "dungeon.records.empty"));
  } else if (subcommand === "player") {
    const member = await resolveMember(interaction, context.guildId, context.memberId);
    if (!member) throw new Error("Player not found.");
    const summary = await playerSummary(prisma, context.guildId, member.id);
    embed.setTitle(t(lang, "dungeon.player.title", { name: member.displayName }));
    if (summary.completed === 0 && summary.recent.length === 0 && summary.allTimePoints === 0) {
      embed.setDescription(t(lang, "dungeon.player.none", { name: member.displayName }));
    } else {
      embed.addFields(
        { name: t(lang, "dungeon.player.points"), value: t(lang, "dungeon.player.pointsValue", { week: summary.weekPoints, season: summary.seasonPoints, all: summary.allTimePoints }) },
        { name: t(lang, "dungeon.player.runs"), value: t(lang, "dungeon.player.runsValue", { count: summary.completed, deathless: summary.deathlessRuns }) }
      );
      const currentSeason = await activeSeasonOrNull(prisma, context.guildId);
      if (currentSeason && hasDungeonRating(currentSeason.ratingRules)) {
        const ratings = (await dungeonRating(prisma, context.guildId, currentSeason)).filter(row => row.memberId === member.id);
        embed.addFields({ name: lang === "fr" ? "Score par personnage" : "Per-character rating",
          value: ratings.length ? ratings.map(row => `${escapeMarkdown(row.name)}${row.bracket ? ` (${row.bracket})` : ""} · ${row.points} · ${row.dungeons} ${lang === "fr" ? "donjon(s)" : "dungeon(s)"}`).join("\n").slice(0, 1024) : "0" });
      }
      if (summary.bests.length) {
        embed.addFields({ name: t(lang, "dungeon.player.bests"), value: summary.bests.map((row) => `• ${label(row)} — ${formatDuration(row.durationSec)}`).join("\n").slice(0, 1024) });
      }
      if (summary.achievements.length) {
        embed.addFields({ name: t(lang, "dungeon.player.achievements"), value: summary.achievements.map((row) => achievementName(row.key, lang, row.seasonName)).join(" · ").slice(0, 1024) });
      }
      if (summary.recent.length) {
        embed.addFields({ name: t(lang, "dungeon.player.recent"), value: summary.recent.map((run) => runLine(run, lang)).join("\n").slice(0, 1024) });
      }
    }
  } else if (subcommand === "history") {
    const member = interaction.options.getUser("member") ? await resolveMember(interaction, context.guildId, null) : null;
    const runs = await recentRuns(prisma, context.guildId, member?.id ?? null, 10);
    embed.setTitle(member ? `${t(lang, "dungeon.history.title")} — ${member.displayName}` : t(lang, "dungeon.history.title"));
    embed.setDescription(runs.length ? runs.map((run) => runLine(run, lang)).join("\n").slice(0, 4000) : t(lang, "dungeon.history.empty"));
  } else {
    const season = await activeSeasonOrNull(prisma, context.guildId);
    if (!season) {
      embed.setDescription(t(lang, "dungeon.season.none"));
    } else {
      if (hasDungeonRating(season.ratingRules)) {
        const rows = await dungeonRating(prisma, context.guildId, season);
        await interaction.reply({ embeds: [ratingEmbed(rows, season.name, lang, season.ratingRules, bracketChoice(interaction, rows, context.memberId))], allowedMentions: { parse: [] } });
        return;
      }
      const runs = await prisma.dungeonRun.count({ where: { guildId: context.guildId, seasonId: season.id, valid: true, state: "COMPLETED" } });
      const top = await leaderboard(prisma, context.guildId, "season", null, 5);
      embed.setTitle(t(lang, "dungeon.season.title", { season: season.name }))
        .setDescription(t(lang, "dungeon.season.since", { date: `<t:${Math.floor(season.startsAt.getTime() / 1000)}:D>`, runs }));
      if (top.length) embed.addFields({ name: t(lang, "dungeon.season.top"), value: formatLeaderboard(top) });
    }
  }
  // Leaderboards use the V2 layout with a link to the public page; other replies stay embeds.
  await interaction.reply(subcommand === "leaderboard"
    ? v2Reply(embed, { link: await publicBoardLink(context.guildId, lang) })
    : { embeds: [embed], allowedMentions: { parse: [] } });
}

// The guild's public leaderboard page, when it shares its runs and this bot has a website.
async function publicBoardLink(guildId: string, lang: Lang): Promise<V2Link | undefined> {
  if (!config.PUBLIC_SITE_URL) return undefined;
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { publicDungeonRuns: true } });
  if (!settings?.publicDungeonRuns) return undefined;
  return { label: lang === "fr" ? "Classements publics" : "Public leaderboards",
    url: `${new URL(config.PUBLIC_SITE_URL).origin}/leaderboards/guild/${encodeURIComponent(guildId)}?lang=${lang}` };
}
