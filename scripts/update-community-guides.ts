// Explicit maintenance action: REST only, never starts a second bot session.
import { REST, Routes, ChannelType, type APIMessage, type APIChannel } from "discord.js";
import { config } from "../src/config.js";
import { prisma } from "../src/database.js";
import { asLang } from "../src/i18n.js";
import { dungeonSignupGuideComponents, dungeonSignupGuideText, DUNGEON_GUIDE_CREATE_ID, DUNGEON_GUIDE_KIND_ID } from "../src/services/dungeon-guide.js";
import { guideText } from "../src/commands/craft-board.js";
import { professionDirectoryText } from "../src/services/profession-directory.js";

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
try {
  const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: config.DISCORD_GUILD_ID }, include: { settings: true } });
  const settings = guild.settings;
  if (!settings) throw new Error("Guild settings are missing.");
  const lang = asLang(settings.language);
  if (settings.dungeonSignupChannelId) {
    const pinned = await rest.get(Routes.channelMessagesPins(settings.dungeonSignupChannelId)) as { items: { message: APIMessage }[] };
    const pins = pinned.items.map((item) => item.message);
    const guide = pins.find((message) => message.author.id === config.DISCORD_CLIENT_ID && JSON.stringify(message.components).match(new RegExp(`${DUNGEON_GUIDE_CREATE_ID}|${DUNGEON_GUIDE_KIND_ID}`)));
    const body = { content: dungeonSignupGuideText(lang), components: dungeonSignupGuideComponents(lang).map((row) => row.toJSON()), allowed_mentions: { parse: [] } };
    if (guide) await rest.patch(Routes.channelMessage(settings.dungeonSignupChannelId, guide.id), { body });
    else {
      const posted = await rest.post(Routes.channelMessages(settings.dungeonSignupChannelId), { body }) as APIMessage;
      await rest.put(Routes.channelMessagesPin(settings.dungeonSignupChannelId, posted.id));
    }
    console.log("Updated dungeon signup guide.");
  }
  if (settings.craftChannelId) {
    const channel = await rest.get(Routes.channel(settings.craftChannelId)) as APIChannel;
    if (channel.type === ChannelType.GuildForum) {
      const active = await rest.get(Routes.guildActiveThreads(guild.discordId)) as { threads: { id: string; parent_id: string; name: string; flags?: number }[] };
      const threads = active.threads.filter((thread) => thread.parent_id === settings.craftChannelId);
      const directoryName = "Guild profession directory";
      const directory = threads.find((thread) => thread.name === directoryName);
      const directoryBody = { content: await professionDirectoryText(prisma, guild.id, lang), allowed_mentions: { parse: [] } };
      let directoryId = directory?.id;
      if (directory) await rest.patch(Routes.channelMessage(directory.id, directory.id), { body: directoryBody });
      else {
        const created = await rest.post(Routes.threads(settings.craftChannelId), { body: { name: directoryName, auto_archive_duration: 1440, message: directoryBody } }) as { id: string };
        directoryId = created.id;
      }
      // Discord forums allow just one pinned thread. Keep the existing request guide pinned.
      if (directoryId && !threads.some((thread) => thread.flags && (thread.flags & 2) !== 0 && thread.id !== directoryId)) {
        await rest.patch(Routes.channel(directoryId), { body: { flags: (directory?.flags ?? 0) | 2 } });
      }
      const guides = threads.filter((thread) => thread.flags && (thread.flags & 2) !== 0 && thread.name !== directoryName);
      for (const thread of guides) {
        const starter = await rest.get(Routes.channelMessage(thread.id, thread.id)) as APIMessage;
        if (starter.author.id === config.DISCORD_CLIENT_ID && starter.components?.length) {
          await rest.patch(Routes.channelMessage(thread.id, thread.id), { body: {
            content: guideText(lang),
            embeds: [{ title: lang === "fr" ? "Artisans de la guilde" : "Guild profession directory", description: directoryBody.content, color: 0xd4af37 }],
            allowed_mentions: { parse: [] }
          } });
        }
      }
      console.log("Updated craft guide and profession directory.");
    }
  }
} finally { await prisma.$disconnect(); }
