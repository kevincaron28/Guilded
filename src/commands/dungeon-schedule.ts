import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import { carriedRules } from "../services/dungeon-season-schedule.js";
import { validBracketedRules } from "../services/dungeon-november-rules.js";
import { loadOfficialWindows, officialWindowAt, scheduledNext, type OfficialWindow } from "../services/official-seasons.js";
import { guildService, requireGuildContext } from "./context.js";

// /organize dungeon-seasons preview: read-only view of the bot owner's season calendar
// (services/official-seasons.ts). Officers no longer start, end or schedule dungeon seasons.
export const dungeonScheduleCommand = new SlashCommandBuilder()
  .setName("dungeon-seasons")
  .setDescription("Dungeon seasons: the current one and the next (set by the Guilded owner)")
  .addSubcommand(sub => sub.setName("preview").setDescription("The current and next dungeon seasons (read only)"));

const at = (date: Date, style = "f") => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

export function scheduleEmbed(windows: OfficialWindow[], active: { name: string; startsAt: Date; ratingRules: unknown } | null, fr: boolean, now = new Date()): EmbedBuilder {
  const current = officialWindowAt(windows, now);
  const next = scheduledNext(windows, now);
  const carried = carriedRules(active);
  const lines = [
    fr ? "Les saisons de donjon sont fixées par le propriétaire de Guilded pour toutes les guildes : une nouvelle saison à chaque grosse mise à jour, ou après 2 à 3 mois."
      : "Dungeon seasons are set by the Guilded owner for every guild: a new season with each big patch, or after 2-3 months.",
    current ? (fr ? `Saison officielle : **${current.name}** depuis ${at(current.start)}${current.end ? `, jusqu’à ${at(current.end)}` : ", sans date de fin pour l’instant"}.`
      : `Official season: **${current.name}** since ${at(current.start)}${current.end ? `, until ${at(current.end)}` : ", no end date yet"}.`)
      : (fr ? "Aucune saison officielle n’a commencé : les essais comptent pour la bêta." : "No official season has started yet: runs count for the beta."),
    next ? (fr ? `Prochaine : **${next.name}** le ${at(next.start)} (${at(next.start, "R")}).` : `Next: **${next.name}** on ${at(next.start)} (${at(next.start, "R")}).`) : "",
    active ? (fr ? `Saison de cette guilde : **${active.name}** (depuis ${at(active.startsAt, "d")}).` : `This guild's season: **${active.name}** (since ${at(active.startsAt, "d")}).`)
      : (fr ? "Aucune saison active dans cette guilde." : "No active season in this guild."),
    fr ? "À chaque début : sauvegarde, archivage de la saison (classement, cote et champions figés; runs et points gardés), nouvelle saison."
      : "At each start: a backup, then the season is archived (standings, rating and champions frozen; runs and points kept) and the new one starts.",
    validBracketedRules(carried) && carried.provisional
      ? (fr ? `Règles reportées : toutes les tranches de niveaux, cibles provisoires et recalibrages inclus (${carried.catalog.length} parcours).`
        : `Rules carried over: all level brackets, provisional targets and recalibrations included (${carried.catalog.length} routes).`)
      : (fr ? "Règles reportées : celles de la saison active." : "Rules carried over: the active season's."),
    fr ? "Classement de la semaine : remis à zéro à la réinitialisation hebdomadaire (mardi 15 h UTC)." : "Weekly board: resets at the weekly reset (Tuesday 15:00 UTC)."
  ].filter(Boolean);
  return new EmbedBuilder().setColor(0x8b5cf6).setTitle(fr ? "Saisons de donjon" : "Dungeon seasons").setDescription(lines.join("\n\n"));
}

export async function executeDungeonSchedule(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const fr = asLang((await guildService.getSettings(context.guildId))?.language) === "fr";
  const active = await prisma.dungeonSeason.findFirst({ where: { guildId: context.guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  await interaction.reply({ embeds: [scheduleEmbed(await loadOfficialWindows(prisma), active, fr)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
