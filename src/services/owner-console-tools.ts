import { ChannelType, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import { CORE_CHANNELS, createSectionChannels, gatherFacts } from "../commands/setup.js";
import { guideText as craftGuideText, postBoardGuide } from "../commands/craft-board.js";
import { updateBotMessages } from "./bot-messages.js";
import { updateDungeonLeaderboard } from "./dungeon-leaderboard.js";
import { ensureAllCoresDiscord } from "./raid-core.js";
import { formatChecks, setupChecks } from "./setup-status.js";
import type { ConsoleTools } from "./owner-console.js";

// The real Discord-touching actions behind the owner console, reusing /setup's own functions so a
// server gets exactly what its officers would get from the buttons.
const settingsOf = async (dbGuildId: string) => prisma.guildSettings.findUnique({ where: { guildId: dbGuildId } });

export const consoleTools: ConsoleTools = {
  async updateMessages(guild: DiscordGuild, dbGuildId: string) {
    const settings = await settingsOf(dbGuildId);
    if (!settings) return "That server has no settings yet.";
    const lang = asLang(settings.language);
    return updateBotMessages(guild, settings, lang, {
      craftGuide: async () => {
        if (!settings.craftChannelId) return;
        const forum = await guild.channels.fetch(settings.craftChannelId).catch(() => null);
        if (forum?.type !== ChannelType.GuildForum) return;
        const pinned = (await forum.threads.fetchActive().catch(() => null))?.threads.find((thread) => thread.flags.has("Pinned"));
        const starter = pinned ? await pinned.fetchStarterMessage().catch(() => null) : null;
        if (starter?.editable) { if (starter.content !== craftGuideText(lang)) await starter.edit({ content: craftGuideText(lang) }); }
        else if (!pinned) await postBoardGuide(forum, lang);
      },
      leaderboard: () => updateDungeonLeaderboard(guild),
      rosters: () => ensureAllCoresDiscord(guild, prisma, dbGuildId)
    });
  },
  async createChannels(guild: DiscordGuild, dbGuildId: string) {
    const settings = await settingsOf(dbGuildId);
    return createSectionChannels(guild, dbGuildId, CORE_CHANNELS, asLang(settings?.language));
  },
  async setupCheck(guild: DiscordGuild, dbGuildId: string) {
    const settings = await settingsOf(dbGuildId);
    if (!settings) return "That server has no settings yet.";
    const text = formatChecks(setupChecks(await gatherFacts(guild, dbGuildId, settings), asLang(settings.language)));
    return text.length > 1800 ? `${text.slice(0, 1790)}…` : text;
  }
};
