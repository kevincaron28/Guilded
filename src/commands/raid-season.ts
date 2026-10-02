import { AttachmentBuilder, EmbedBuilder, type ChatInputCommandInteraction, type Guild as DiscordGuild, type GuildMember } from "discord.js";
import type { RaidSeason } from "@prisma/client";
import { prisma } from "../database.js";
import { asLang, type Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { resolveNotifyChannel } from "../services/notify.js";
import { createRaidCoreService } from "../services/raid-core.js";
import {
  findSeason, parseSeasonStart, seasonAt, seasonAttendance, seasonCsv, splitByCore, startSeason,
  type SeasonAttendance, type SeasonCell, type SeasonRow
} from "../services/raid-season.js";
import { guildService } from "./context.js";

const ICON: Record<string, string> = { PRESENT: "✅", LATE: "⏰", BENCHED: "🪑", ABSENT: "❌", UNRECORDED: "❓" };
// With no season yet, the report covers this many days back.
const DEFAULT_DAYS = 90;
const stamp = (date: Date, style = "D") => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

interface Window { name: string; from: Date; until: Date | null }

function totalsText(row: SeasonRow): string {
  return ([["PRESENT", row.present], ["LATE", row.late], ["BENCHED", row.benched], ["ABSENT", row.absent], ["UNRECORDED", row.unrecorded]] as const)
    .filter(([, count]) => count > 0).map(([status, count]) => `${ICON[status]}${count}`).join(" ");
}

// One embed per raid core (a single one when the raids share a core): each member's rate,
// their count per status and their last five raids. Names only, so nobody is pinged.
export function seasonSummaryEmbeds(data: SeasonAttendance, window: Window, lang: Lang = "en"): EmbedBuilder[] {
  const say = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const period = `${stamp(window.from)} → ${window.until ? stamp(window.until) : say("now", "maintenant")}`;
  const title = (core: string | null) => `🧾 ${say("Attendance", "Présences")} — ${window.name}${core ? ` · ${core}` : ""}`.slice(0, 250);
  if (!data.raids.length) {
    return [new EmbedBuilder().setTitle(title(null)).setColor(0xd4a017)
      .setDescription(`${period}\n${say("No completed raid in this period yet.", "Aucun raid terminé dans cette période pour l'instant.")}`)];
  }
  const parts = splitByCore(data).slice(0, 10);
  // Discord allows 6000 characters over all the embeds of one message.
  const room = Math.min(3900, Math.floor(5200 / parts.length));
  return parts.map((part) => {
    const rows = [...part.data.rows].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name));
    let text = `${period} · ${part.data.raids.length} raid${part.data.raids.length === 1 ? "" : "s"}\n`;
    let shown = 0;
    for (const row of rows) {
      const last = row.cells.filter((cell): cell is Exclude<SeasonCell, null> => cell !== null).slice(-5).map((cell) => ICON[cell]).join("");
      const line = `\`${percent(row.rate).padStart(4)}\` **${row.name}** ${totalsText(row)} · ${last}\n`;
      if (text.length + line.length > room - 40) break;
      text += line;
      shown++;
    }
    if (shown < rows.length) text += say(`… and ${rows.length - shown} more: see the file from /raid history.`, `… et ${rows.length - shown} de plus : voir le fichier de /raid history.`);
    return new EmbedBuilder().setTitle(title(parts.length > 1 || part.coreName ? part.coreName ?? say("No core", "Sans noyau") : null)).setColor(0xd4a017)
      .setDescription(text).setFooter({ text: say("% = recorded raids attended (late counts half, benched in full). ❓ = expected, nobody recorded it.", "% = raids notés où le joueur était là (retard = moitié, banc = complet). ❓ = attendu, personne ne l'a noté.") });
  });
}

// One player's season: every raid that concerned them, newest first.
export function playerHistoryEmbed(data: SeasonAttendance, row: SeasonRow | undefined, window: Window, name: string, lang: Lang = "en"): EmbedBuilder {
  const say = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const embed = new EmbedBuilder().setTitle(`🧾 ${name} — ${window.name}`.slice(0, 250)).setColor(0xd4a017);
  if (!row) return embed.setDescription(say("No raid of this period concerned this player.", "Aucun raid de cette période ne concernait ce joueur."));
  const label: Record<string, string> = {
    PRESENT: say("Present", "Présent"), LATE: say("Late", "En retard"), BENCHED: say("Benched", "Sur le banc"),
    ABSENT: say("Absent", "Absent"), UNRECORDED: say("Not recorded", "Non noté")
  };
  let text = `**${percent(row.rate)}** · ${totalsText(row)}\n`;
  for (let index = data.raids.length - 1; index >= 0; index--) {
    const cell = row.cells[index];
    const raid = data.raids[index]!;
    if (!cell) continue;
    const line = `${stamp(raid.scheduledAt, "d")} ${ICON[cell]} ${label[cell]} — ${raid.title}\n`;
    if (text.length + line.length > 3900) { text += "…"; break; }
    text += line;
  }
  return embed.setDescription(text);
}

function windowOf(season: RaidSeason | null, lang: Lang): Window {
  if (season) return { name: season.name, from: season.startsAt, until: season.endsAt };
  return { name: lang === "fr" ? `${DEFAULT_DAYS} derniers jours` : `Last ${DEFAULT_DAYS} days`, from: new Date(Date.now() - DEFAULT_DAYS * 86_400_000), until: null };
}

function requireOfficer(interaction: ChatInputCommandInteraction): void {
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    throw new Error("Only Officers and Guild Masters can see or change raid attendance seasons.");
  }
}

// Posts the season's summary in the officers' attendance channel (or the officer log), or edits
// the one already there. Called after each raid report; never throws.
export async function refreshSeasonSummary(discordGuild: DiscordGuild | null, guildId: string, at = new Date()): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const season = await seasonAt(prisma, guildId, at);
    if (!season) return false;
    const target = await resolveNotifyChannel(discordGuild, "attendance");
    if (!target) return false;
    const data = await seasonAttendance(prisma, guildId, { from: season.startsAt, until: season.endsAt });
    const payload = { embeds: seasonSummaryEmbeds(data, { name: season.name, from: season.startsAt, until: season.endsAt }, target.lang), allowedMentions: { parse: [] } };
    if (season.summaryMessageId && season.summaryChannelId === target.channel.id) {
      const edited = await target.channel.messages.edit(season.summaryMessageId, payload).then(() => true, () => false);
      if (edited) return true;
    }
    const message = await target.channel.send(payload);
    await message.pin().catch(() => undefined);
    await prisma.raidSeason.update({ where: { id: season.id }, data: { summaryChannelId: target.channel.id, summaryMessageId: message.id } });
    return true;
  } catch (error) {
    console.error("Failed to refresh the raid season summary", error);
    return false;
  }
}

// /raid season: with a name, starts a season (closing the one before); alone, lists them.
export async function executeRaidSeason(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  requireOfficer(interaction);
  const settings = await guildService.getSettings(guildId);
  const lang = asLang(settings?.language);
  const say = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const name = interaction.options.getString("name");
  const start = interaction.options.getString("start");
  if (!name) {
    if (start) throw new Error("Give the new season a name too.");
    const seasons = await prisma.raidSeason.findMany({ where: { guildId }, orderBy: { startsAt: "desc" }, take: 15 });
    await interaction.reply({
      content: seasons.length
        ? seasons.map((season) => `• **${season.name}** — ${stamp(season.startsAt)} → ${season.endsAt ? stamp(season.endsAt) : say("now", "maintenant")}`).join("\n")
        : say("No raid season yet. Start one with `/raid season name:<name>` (add `start:2026-09-01` to begin it in the past).", "Aucune saison de raid. Commencez-en une avec `/raid season name:<nom>` (ajoutez `start:2026-09-01` pour la faire débuter dans le passé)."),
      ephemeral: true
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const season = await startSeason(prisma, {
    guildId, name, createdBy: interaction.user.id,
    startsAt: start ? parseSeasonStart(start, settings?.timezone ?? "America/Toronto") : new Date()
  });
  const posted = await refreshSeasonSummary(interaction.guild, guildId);
  await interaction.editReply({
    content: say(`Season **${season.name}** started ${stamp(season.startsAt)}; the season before it, if any, ends there.`, `La saison **${season.name}** commence le ${stamp(season.startsAt)}; la précédente, s'il y en a une, se termine là.`)
      + (posted ? say(" Its summary is pinned in the attendance channel and updates after each raid report.", " Son résumé est épinglé dans le salon des présences et se met à jour après chaque rapport de raid.")
        : say(" No attendance channel or officer log is set, so no summary was posted.", " Aucun salon de présences ni journal des officiers n'est configuré : aucun résumé publié."))
  });
}

// /raid history: the season's attendance for officers, as a summary plus the full grid in a
// file; or one player's raids. Only the officer who asked sees it.
export async function executeRaidHistory(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  requireOfficer(interaction);
  await interaction.deferReply({ ephemeral: true });
  const settings = await guildService.getSettings(guildId);
  const lang = asLang(settings?.language);
  const wanted = interaction.options.getString("season");
  const season = wanted ? await findSeason(prisma, guildId, wanted) : await seasonAt(prisma, guildId);
  if (wanted && !season) throw new Error(`No raid season "${wanted}". See /raid season.`);
  const coreName = interaction.options.getString("core");
  const core = coreName ? await createRaidCoreService(prisma).byIdOrName(guildId, coreName) : null;
  const window = windowOf(season, lang);
  const data = await seasonAttendance(prisma, guildId, { from: window.from, until: window.until, coreId: core?.id ?? null });
  const note = season ? "" : lang === "fr" ? "Aucune saison de raid n'est en cours : voici les 90 derniers jours. `/raid season` en commence une." : "No raid season is running, so this covers the last 90 days. `/raid season` starts one.";

  const player = interaction.options.getUser("player");
  if (player) {
    const member = await prisma.member.findFirst({ where: { guildId, discordUserId: player.id }, select: { id: true, displayName: true } });
    const row = member ? data.rows.find((entry) => entry.memberId === member.id) : undefined;
    await interaction.editReply({ content: note, embeds: [playerHistoryEmbed(data, row, window, member?.displayName ?? player.username, lang)] });
    return;
  }
  const files = data.raids.length
    ? [new AttachmentBuilder(Buffer.from(seasonCsv(data, settings?.timezone ?? "America/Toronto"), "utf8"), { name: "raid-attendance.csv" })]
    : [];
  await interaction.editReply({ content: note, embeds: seasonSummaryEmbeds(data, window, lang), files, allowedMentions: { parse: [] } });
}
