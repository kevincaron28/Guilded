import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { createAuditService } from "../services/audit.js";
import { postToLogChannel } from "../services/housekeeping.js";
import {
  DEFAULT_SCHEDULE, carriedRules, loadSchedule, saveSchedule, seasonWindowAt, upcomingWindows, validTimeZone, type SeasonSchedule
} from "../services/dungeon-season-schedule.js";
import { validBracketedRules } from "../services/dungeon-november-rules.js";
import { guildService, requireGuildContext } from "./context.js";

const auditService = createAuditService(prisma);

// /organize dungeon-seasons: monthly dungeon seasons (services/dungeon-season-schedule.ts).
export const dungeonScheduleCommand = new SlashCommandBuilder()
  .setName("dungeon-seasons")
  .setDescription("Officers: monthly dungeon seasons from the release date")
  .addSubcommand(sub => sub.setName("preview").setDescription("The schedule and the next seasons (nothing changes)"))
  .addSubcommand(sub => sub.setName("on").setDescription("Rotate dungeon seasons monthly, automatically")
    .addStringOption(o => o.setName("first_start").setDescription("First season's date, e.g. 2026-11-04"))
    .addIntegerOption(o => o.setName("hour").setDescription("Start hour, 0-23 (default 0)").setMinValue(0).setMaxValue(23))
    .addStringOption(o => o.setName("time_zone").setDescription("e.g. America/Toronto")))
  .addSubcommand(sub => sub.setName("off").setDescription("Stop automatic rotation (the current season stays)"));

const at = (date: Date, style = "f") => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

export function scheduleEmbed(schedule: SeasonSchedule, active: { name: string; startsAt: Date; ratingRules: unknown } | null, fr: boolean, now = new Date()): EmbedBuilder {
  const current = seasonWindowAt(schedule, now);
  const windows = upcomingWindows(schedule, now, 4);
  const next = windows.find(w => w.start > now);
  const carried = carriedRules(active);
  const lines = [
    schedule.enabled ? (fr ? "✅ **Rotation mensuelle activée.**" : "✅ **Monthly rotation is on.**") : (fr ? "⏸️ **Rotation mensuelle désactivée** (`/organize dungeon-seasons on`)." : "⏸️ **Monthly rotation is off** (`/organize dungeon-seasons on`)."),
    fr ? `Saison 1 : ${schedule.firstStart} à ${schedule.hour} h (${schedule.timeZone}), puis une saison par mois civil, au 1er du mois à la même heure.`
      : `Season 1: ${schedule.firstStart} at ${schedule.hour}:00 (${schedule.timeZone}), then one season per calendar month, on the 1st at the same hour.`,
    active ? (fr ? `Saison active : **${active.name}** (depuis ${at(active.startsAt, "d")}).` : `Active season: **${active.name}** (since ${at(active.startsAt, "d")}).`)
      : (fr ? "Aucune saison active." : "No active season."),
    !current && next ? (fr ? `Rien ne change avant ${at(next.start)} : la saison active n’est archivée qu’à ce moment.` : `Nothing changes before ${at(next.start)}: the active season is archived only then.`) : "",
    fr ? "À chaque début : sauvegarde, archivage de la saison (classement, cote et champions figés; runs et points gardés), nouvelle saison."
      : "At each start: a backup, then the season is archived (standings, rating and champions frozen; runs and points kept) and the new one starts.",
    validBracketedRules(carried) && carried.provisional
      ? (fr ? `Règles reportées : toutes les tranches de niveaux, cibles provisoires et recalibrages inclus (${carried.catalog.length} parcours).`
        : `Rules carried over: all level brackets, provisional targets and recalibrations included (${carried.catalog.length} routes).`)
      : (fr ? "Règles reportées : celles de la saison active." : "Rules carried over: the active season's."),
    fr ? "Classement de la semaine : remis à zéro à la réinitialisation hebdomadaire (mardi 15 h UTC)." : "Weekly board: resets at the weekly reset (Tuesday 15:00 UTC)."
  ].filter(Boolean);
  return new EmbedBuilder().setColor(0x8b5cf6).setTitle(fr ? "Saisons de donjons mensuelles" : "Monthly dungeon seasons").setDescription(lines.join("\n\n"))
    .addFields({ name: fr ? "Prochaines saisons" : "Next seasons", value: windows.map(w => `**${w.name}** · ${at(w.start)} → ${at(w.end)}${w.index === current?.index ? (fr ? " · en cours" : " · running") : ""}`).join("\n") });
}

export async function executeDungeonSchedule(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const fr = asLang((await guildService.getSettings(context.guildId))?.language) === "fr";
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: fr ? "Réservé aux officiers." : "Only officers can change dungeon seasons.", flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();
  let schedule = await loadSchedule(prisma, context.guildId);
  if (sub !== "preview") {
    const firstStart = interaction.options.getString("first_start")?.trim();
    const hour = interaction.options.getInteger("hour");
    const timeZone = interaction.options.getString("time_zone")?.trim();
    if (firstStart && (!/^\d{4}-\d{2}-\d{2}$/.test(firstStart) || Number.isNaN(Date.parse(`${firstStart}T00:00:00Z`)))) throw new Error(fr ? "Date au format AAAA-MM-JJ, p. ex. 2026-11-04." : "Use a YYYY-MM-DD date, e.g. 2026-11-04.");
    if (timeZone && !validTimeZone(timeZone)) throw new Error(fr ? "Fuseau horaire inconnu (p. ex. America/Toronto)." : "Unknown time zone (e.g. America/Toronto).");
    schedule = { ...DEFAULT_SCHEDULE, ...schedule, enabled: sub === "on", ...(firstStart ? { firstStart } : {}), ...(hour !== null ? { hour } : {}),
      ...(timeZone ? { timeZone } : {}), updatedBy: interaction.user.id, updatedAt: new Date().toISOString() };
    await saveSchedule(prisma, context.guildId, schedule);
    const summary = `monthly dungeon seasons ${sub} (first ${schedule.firstStart} ${schedule.hour}:00 ${schedule.timeZone})`;
    await auditService.record({ guildId: context.guildId, actorId: interaction.user.id, action: "DUNGEON_ADMIN", metadata: { action: `season-schedule-${sub}`, firstStart: schedule.firstStart, hour: schedule.hour, timeZone: schedule.timeZone } });
    if (interaction.guild) await postToLogChannel(interaction.guild, `🏰 ${interaction.user.username}: ${summary}`);
  }
  const active = await prisma.dungeonSeason.findFirst({ where: { guildId: context.guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  await interaction.reply({ embeds: [scheduleEmbed(schedule, active, fr)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
