import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../database.js";
import { validTimeZone, zonedInstant } from "../services/dungeon-season-schedule.js";
import {
  cancelNextSeason, loadOfficialWindows, officialWindowAt, scheduleNextSeason, scheduledNext, SeasonCalendarError, type OfficialWindow
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
  const sub = interaction.options.getSubcommand();
  const now = new Date();
  let note = "";
  try {
    if (sub === "next") {
      const [y, m, d] = (/^(\d{4})-(\d{2})-(\d{2})$/.exec(interaction.options.getString("date", true).trim()) ?? []).slice(1).map(Number);
      if (!y || !m || !d) throw new SeasonCalendarError("Give the date as YYYY-MM-DD.");
      const zone = interaction.options.getString("time_zone")?.trim() || "America/Los_Angeles";
      if (!validTimeZone(zone)) throw new SeasonCalendarError(`Unknown time zone: ${zone}.`);
      const startsAt = zonedInstant(y, m - 1, d, interaction.options.getInteger("hour") ?? 15, zone);
      const season = await scheduleNextSeason(prisma, { name: interaction.options.getString("name"), startsAt, actorId: interaction.user.id }, now);
      note = `Scheduled **${season.name}** for ${at(season.start)}.`;
    } else if (sub === "cancel") {
      const cancelled = await cancelNextSeason(prisma, now);
      note = cancelled ? `Cancelled **${cancelled.name}**; the current season keeps running with no end.` : "No next season was scheduled.";
    }
  } catch (error) {
    if (!(error instanceof SeasonCalendarError)) throw error;
    await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ ...(note ? { content: note } : {}), embeds: [calendarEmbed(await loadOfficialWindows(prisma), now)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
