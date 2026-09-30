import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { t, type Lang } from "../i18n.js";
import { notifyEmbed } from "../services/notify.js";
import { buildRaidReport, formatDuration, type RaidReport } from "../services/raid-report.js";
import { linkedReport } from "../services/wcl.js";

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

// Posts the report to the raid-logs channel (or announcements), in the guild's language.
// Returns false when no channel is configured.
export async function postRaidReport(discordGuild: DiscordGuild | null, guildId: string, raidId: string): Promise<boolean> {
  const report = await buildRaidReport(prisma, guildId, raidId);
  const raid = await prisma.raid.findFirst({ where: { guildId, id: raidId }, select: { coreId: true } });
  const wcl = await linkedReport(prisma, guildId, raidId).catch(() => null);
  return notifyEmbed(discordGuild, (lang) => {
    const embed = raidReportEmbed(report, lang);
    if (wcl) embed.addFields({ name: "Warcraft Logs", value: `[${wcl.title}](${wcl.url})` });
    return embed;
  }, "raidLog", raid?.coreId ?? null);
}
