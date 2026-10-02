import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { t, type Lang } from "../i18n.js";
import { notifyEmbed } from "../services/notify.js";
import { buildRaidAttendance, buildRaidReport, formatDuration, type RaidAttendanceList, type RaidReport } from "../services/raid-report.js";
import { linkedReport } from "../services/wcl.js";
import { refreshSeasonSummary } from "./raid-season.js";

export function raidReportEmbed(report: RaidReport, lang: Lang = "en"): EmbedBuilder {
  const none = t(lang, "report.noneRecorded");
  const bosses = report.bossesPlanned > 0
    ? `${report.bossesKilled}/${report.bossesPlanned}${report.killedNames.length ? `\n${report.killedNames.join(", ")}` : ""}`
    : report.killedNames.length ? report.killedNames.join(", ") : none;
  const embed = new EmbedBuilder()
    .setTitle(t(lang, "report.title", { raid: report.title }))
    .setDescription(t(lang, report.endedAt ? "report.completed" : "report.inProgress"))
    .addFields(
      { name: t(lang, "report.duration"), value: formatDuration(report.durationMinutes), inline: true },
      { name: t(lang, "report.raiders"), value: `${report.raiders}${report.late ? ` (${t(lang, "report.late", { count: report.late })})` : ""}`, inline: true },
      { name: t(lang, "report.bosses"), value: bosses.slice(0, 1000), inline: true },
      {
        name: t(lang, "report.epgp"),
        value: report.epRecipients ? t(lang, "report.epValue", { ep: report.epAwarded, count: report.epRecipients }) : t(lang, "report.epPending"),
        inline: true
      },
      { name: t(lang, "report.loot"), value: report.lootCount ? t(lang, "report.lootValue", { count: report.lootCount, gp: report.gpSpent }) : none, inline: true }
    );
  if (report.topLoot.length) {
    embed.addFields({
      name: t(lang, "report.topItems"),
      value: report.topLoot.map((loot) => `${loot.item} → ${loot.winner} (${loot.gp} GP)`).join("\n").slice(0, 1000)
    });
  }
  if (report.endedAt) embed.setTimestamp(report.endedAt);
  return embed;
}

// The officers' view of a raid: every member by attendance status. Names are mentions that
// never ping (the delivery strips them).
export function raidAttendanceEmbed(list: RaidAttendanceList, lang: Lang = "en"): EmbedBuilder {
  const say = (en: string, fr: string) => lang === "fr" ? fr : en;
  const embed = new EmbedBuilder().setTitle(`🧾 ${say("Attendance", "Présences")} — ${list.title}`.slice(0, 250)).setColor(0xd4a017);
  const groups: [string, string[]][] = [
    [say("✅ Present", "✅ Présents"), list.present], [say("⏰ Late", "⏰ En retard"), list.late], [say("🪑 Benched", "🪑 Sur le banc"), list.benched],
    [say("❌ Absent", "❌ Absents"), list.absent], [say("❓ Signed up, not recorded", "❓ Inscrits, non notés"), list.unrecorded]
  ];
  for (const [name, ids] of groups) {
    if (!ids.length) continue;
    let value = "";
    for (const id of ids) { const next = `${value}${value ? " " : ""}<@${id}>`; if (next.length > 1000) { value += " …"; break; } value = next; }
    embed.addFields({ name: `${name} (${ids.length})`, value });
  }
  if (!embed.data.fields?.length) embed.setDescription(say("No attendance was recorded for this raid.", "Aucune présence n'a été notée pour ce raid."));
  return embed;
}

// Posts the report to the raid-logs channel (or announcements), in the guild's language,
// and the attendance list to the officers' attendance channel (or the officer log), where the
// season's summary is brought up to date.
// Returns false when no channel is configured.
export async function postRaidReport(discordGuild: DiscordGuild | null, guildId: string, raidId: string): Promise<boolean> {
  const report = await buildRaidReport(prisma, guildId, raidId);
  const raid = await prisma.raid.findFirst({ where: { guildId, id: raidId }, select: { coreId: true, scheduledAt: true } });
  const wcl = await linkedReport(prisma, guildId, raidId).catch(() => null);
  const attendance = await buildRaidAttendance(prisma, guildId, raidId).catch(() => null);
  if (attendance) await notifyEmbed(discordGuild, (lang) => raidAttendanceEmbed(attendance, lang), "attendance");
  if (raid) await refreshSeasonSummary(discordGuild, guildId, raid.scheduledAt);
  return notifyEmbed(discordGuild, (lang) => {
    const embed = raidReportEmbed(report, lang);
    if (wcl) embed.addFields({ name: "Warcraft Logs", value: `[${wcl.title}](${wcl.url})` });
    return embed;
  }, "raidLog", raid?.coreId ?? null);
}
