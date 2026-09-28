import { readFileSync } from "node:fs";
import type { Client } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
export const CURRENT_VERSION = pkg.version;

const NOTICE = {
  en: (v: string) => `🔔 Guilded was updated to **${v}**. Ask an officer what's new, or check CHANGELOG.md.`,
  fr: (v: string) => `🔔 Guilded a été mis à jour vers la version **${v}**. Demandez à un officier ce qui a changé, ou consultez CHANGELOG.md.`
};

// Called once per ClientReady from main.ts: posts a short notice to any
// guild's bot-guide channel when the running version differs from what that
// guild was last told. Marks the guild first so a failed post can't repeat
// every reconnect (same pattern as runWeeklyReports in commands/stats.ts).
export async function announceVersionUpdates(client: Client, currentVersion = CURRENT_VERSION): Promise<number> {
  const pending = await prisma.guildSettings.findMany({
    where: { guideChannelId: { not: null }, lastAnnouncedVersion: { not: currentVersion } },
    include: { guild: true }
  });
  let posted = 0;
  for (const settings of pending) {
    await prisma.guildSettings.update({ where: { id: settings.id }, data: { lastAnnouncedVersion: currentVersion } });
    try {
      const discordGuild = await client.guilds.fetch(settings.guild.discordId);
      const channel = await discordGuild.channels.fetch(settings.guideChannelId ?? "");
      if (!channel?.isTextBased()) continue;
      await channel.send({ content: NOTICE[asLang(settings.language)](currentVersion), allowedMentions: { parse: [] } });
      posted += 1;
    } catch (error) {
      console.error(`Version announcement failed for guild ${settings.guild.discordId}`, error);
    }
  }
  return posted;
}
