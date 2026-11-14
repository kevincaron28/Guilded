import { AttachmentBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../database.js";
import { withEdition } from "../services/edition-context.js";
import { validTimeZone, zonedInstant } from "../services/dungeon-season-schedule.js";
import { activateSeason2, observationsEmbed, loadSeasonObservations, reviewSeason2, season2Embed } from "../services/dungeon-season2-admin.js";
import { BOSS_SCORING_V1 } from "../services/dungeon-boss-scoring.js";
import { SCORING_V2, SEASON2_DATE, SEASON2_NAME } from "../services/dungeon-season2.js";
import {
  cancelNextSeason, configureNextSeasonRules, loadOfficialWindows, officialWindowAt, scheduleNextSeason, scheduledNext, SeasonCalendarError, type OfficialWindow
} from "../services/official-seasons.js";

// /guilded-season: the bot owner's season calendar (services/official-seasons.ts). Registered only in
// the bot's home server (DISCORD_GUILD_ID) and refused for anyone but the Discord application's owner,
// so guild officers cannot start or end dungeon seasons.
export const OWNER_SEASON_COMMAND = "guilded-season";

export const ownerSeasonCommand = new SlashCommandBuilder()
  .setName(OWNER_SEASON_COMMAND)
  .setDescription("Bot owner: the dungeon season calendar every guild follows")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName("status").setDescription("The current season and the next one"))
  .addSubcommand((sub) => sub.setName("next").setDescription("Schedule the next season (it ends the current one)")
    .addStringOption((o) => o.setName("date").setDescription("Start date, e.g. 2027-01-26").setRequired(true))
    .addIntegerOption((o) => o.setName("hour").setDescription("Start hour, 0-23 (default 15)").setMinValue(0).setMaxValue(23))
    .addStringOption((o) => o.setName("time_zone").setDescription("Default America/Los_Angeles"))
    .addStringOption((o) => o.setName("name").setDescription("Default \"Season N\"").setMaxLength(60)))
  .addSubcommand(sub => sub.setName("rules").setDescription("Set reviewed dungeon rules for the next season")
    .addAttachmentOption(o => o.setName("file").setDescription("JSON with gameEdition, routes and brackets").setRequired(true)))
  .addSubcommand(sub => sub.setName("observations").setDescription("Real completion times per dungeon this season (observation only)"))
  .addSubcommand(sub => sub.setName("season2-review").setDescription("Preview Season 2's targets computed from observed times (nothing is scheduled)")
    .addStringOption(o => o.setName("evidence").setDescription("Evidence policy (default current-v2)").addChoices({ name: "current-v2", value: "current-v2" }, { name: "current-v1", value: "current-v1" }))
    .addBooleanOption(o => o.setName("scoring_v2").setDescription("Level-fair targets and a party minimum")).addBooleanOption(o => o.setName("boss_scoring").setDescription("Skipped bosses cost points")))
  .addSubcommand(sub => sub.setName("season2-activate").setDescription("Schedule Season 2 (default 9 December) and store the computed targets")
    .addStringOption(o => o.setName("date").setDescription(`Start date (default ${SEASON2_DATE.date})`))
    .addStringOption(o => o.setName("evidence").setDescription("Evidence policy (default current-v2)").addChoices({ name: "current-v2", value: "current-v2" }, { name: "current-v1", value: "current-v1" }))
    .addBooleanOption(o => o.setName("keep_rules").setDescription("Keep rules already uploaded for the next season"))
    .addBooleanOption(o => o.setName("scoring_v2").setDescription("Level-fair targets and a party minimum")).addBooleanOption(o => o.setName("boss_scoring").setDescription("Skipped bosses cost points")))
  .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel the next season (the current one keeps running)"));

let ownerId: string | null = null;
/** The Discord application's owner (a team's owner for team apps), cached after the first look-up. */
export async function botOwnerId(client: Client): Promise<string | null> {
  if (ownerId) return ownerId;
  const app = await client.application?.fetch();
  const owner = app?.owner;
  ownerId = owner ? ("ownerId" in owner ? owner.ownerId : owner.id) ?? null : null;
  return ownerId;
}

const at = (date: Date, style = "f") => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

export function calendarEmbed(windows: OfficialWindow[], now = new Date()): EmbedBuilder {
  const current = officialWindowAt(windows, now);
  const next = scheduledNext(windows, now);
  const lines = [
    current ? `Current: **${current.name}** since ${at(current.start)}${current.end ? `, ends ${at(current.end)} (${at(current.end, "R")})` : ", no end yet"}.`
      : "No season has started yet: runs count for the beta.",
    next ? `Next: **${next.name}** starts ${at(next.start)} (${at(next.start, "R")}). Every guild's dungeon season rotates then (backup first; standings, rating and champions frozen; runs and points kept).`
      : "No next season scheduled. Use `/guilded-season next` when a big patch lands or after 2-3 months.",
    "Guild officers cannot start or end dungeon seasons; the public leaderboards use the same seasons."
  ];
  const past = windows.filter((w) => w.end && w.end <= now).slice(-5).reverse();
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle("Dungeon season calendar").setDescription(lines.join("\n\n"));
  if (past.length) embed.addFields({ name: "Past seasons", value: past.map((w) => `**${w.name}** · ${at(w.start, "d")} → ${at(w.end!, "d")}`).join("\n") });
  return embed;
}

export async function executeOwnerSeason(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.user.id !== await botOwnerId(interaction.client)) {
    await interaction.reply({ content: "Only the Guilded bot's owner can change dungeon seasons. / Seul le propriétaire du bot Guilded peut changer les saisons.", flags: MessageFlags.Ephemeral });
    return;
  }
  return withEdition("forever", () => executeInEdition(interaction));
}
/** Season 2's start: the date option (YYYY-MM-DD) or the planned 9 December, at 15:00 Pacific like Season 1. */
function season2Start(interaction: ChatInputCommandInteraction): Date {
  const text = (interaction.options.getString("date") ?? SEASON2_DATE.date).trim();
  const [y, m, d] = (/^(\d{4})-(\d{2})-(\d{2})$/.exec(text) ?? []).slice(1).map(Number);
  if (!y || !m || !d) throw new SeasonCalendarError("Give the date as YYYY-MM-DD.");
  return zonedInstant(y, m - 1, d, SEASON2_DATE.hour, SEASON2_DATE.timeZone);
}
const season2Scoring = (interaction: ChatInputCommandInteraction) => interaction.options.getBoolean("scoring_v2") ? SCORING_V2 : undefined;
const season2BossScoring = (interaction: ChatInputCommandInteraction) => interaction.options.getBoolean("boss_scoring") ? BOSS_SCORING_V1 : undefined;
const season2Policy = (interaction: ChatInputCommandInteraction) => interaction.options.getString("evidence") === "current-v1" ? "current-v1" as const : "current-v2" as const;
async function executeInEdition(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "rules" || sub === "observations" || sub === "season2-review" || sub === "season2-activate") await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const now = new Date();
  let note = "";
  let embeds: EmbedBuilder[] | null = null;
  let files: AttachmentBuilder[] = [];
  try {
    if (sub === "next") {
      const [y, m, d] = (/^(\d{4})-(\d{2})-(\d{2})$/.exec(interaction.options.getString("date", true).trim()) ?? []).slice(1).map(Number);
      if (!y || !m || !d) throw new SeasonCalendarError("Give the date as YYYY-MM-DD.");
      const zone = interaction.options.getString("time_zone")?.trim() || "America/Los_Angeles";
      if (!validTimeZone(zone)) throw new SeasonCalendarError(`Unknown time zone: ${zone}.`);
      const startsAt = zonedInstant(y, m - 1, d, interaction.options.getInteger("hour") ?? 15, zone);
      const season = await scheduleNextSeason(prisma, { name: interaction.options.getString("name"), startsAt, actorId: interaction.user.id }, now);
      note = `Scheduled **${season.name}** for ${at(season.start)}.`;
    } else if (sub === "rules") {
      const file = interaction.options.getAttachment("file", true);
      const url = new URL(file.url);
      if (file.size > 200_000 || url.protocol !== "https:" || !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)) throw new SeasonCalendarError("Upload a JSON attachment under 200 KB.");
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(1500) });
      if (!response.ok || !response.body) throw new SeasonCalendarError("Could not read the attached rules.");
      const chunks: Uint8Array[] = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 200_000) throw new SeasonCalendarError("Rules exceed 200 KB.");
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new SeasonCalendarError("The attachment is not valid JSON."); }
      const count = await configureNextSeasonRules(prisma, input, now);
      note = `Saved ${count} reviewed routes for the next season. Existing seasons keep their frozen rules.`;
    } else if (sub === "observations") {
      const loaded = await loadSeasonObservations(prisma, now);
      if (!loaded) throw new SeasonCalendarError("No season has started yet: nothing to observe.");
      embeds = [observationsEmbed(loaded)];
    } else if (sub === "season2-review") {
      const review = await reviewSeason2(prisma, season2Start(interaction), now, season2Policy(interaction), season2Scoring(interaction), season2BossScoring(interaction));
      if (!review) throw new SeasonCalendarError("No season has started yet: nothing to compute from.");
      embeds = [season2Embed(review)];
      files = [new AttachmentBuilder(Buffer.from(JSON.stringify(review.proposal.rules, null, 2)), { name: "season2-rules.json" })];
    } else if (sub === "season2-activate") {
      const result = await activateSeason2(prisma, { startsAt: season2Start(interaction), name: SEASON2_NAME, actorId: interaction.user.id,
        keepRules: interaction.options.getBoolean("keep_rules") ?? false, policy: season2Policy(interaction), scoring: season2Scoring(interaction), bossScoring: season2BossScoring(interaction) }, now);
      note = result.routes === null ? `Scheduled **${result.name}**; the rules already uploaded for it were kept.`
        : `Scheduled **${result.name}** with ${result.routes} targets computed from this season's observed times${result.replaced ? " (replacing the rules stored before)" : ""}. Run \`/guilded-season status\` to confirm.`;
    } else if (sub === "cancel") {
      const cancelled = await cancelNextSeason(prisma, now);
      note = cancelled ? `Cancelled **${cancelled.name}**; the current season keeps running with no end.` : "No next season was scheduled.";
    }
  } catch (error) {
    if (!(error instanceof SeasonCalendarError)) throw error;
    if (interaction.deferred) await interaction.editReply({ content: error.message });
    else await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    return;
  }
  const answer = { ...(note ? { content: note } : {}), embeds: embeds ?? [calendarEmbed(await loadOfficialWindows(prisma), now)], ...(files.length ? { files } : {}), allowedMentions: { parse: [] } };
  if (interaction.deferred) await interaction.editReply(answer);
  else await interaction.reply({ ...answer, flags: MessageFlags.Ephemeral });
}
