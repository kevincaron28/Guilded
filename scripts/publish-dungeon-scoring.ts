// Explicit REST maintenance; never logs in a second bot or changes scores.
import { REST, Routes, type APIMessage, type RESTGetAPIApplicationGuildCommandsResult } from "discord.js";
import { config } from "../src/config.js";
import { prisma } from "../src/database.js";
import { asLang } from "../src/i18n.js";
import { dungeonConfig } from "../src/services/dungeon-rules.js";
import { dungeonScoringGuide } from "../src/services/dungeon-scoring-guide.js";
import { dungeonSignupGuideText, DUNGEON_GUIDE_CREATE_ID } from "../src/services/dungeon-guide.js";

const marker = "Guilded · dungeon-scoring-rules-v1";
try {
  const rest = new REST({ version: "10", timeout: 15000, retries: 1 }).setToken(config.DISCORD_TOKEN);
  const settings = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: config.DISCORD_GUILD_ID } });
  const lang = asLang(settings.language);
  const channelId = settings.dungeonLeaderboardChannelId ?? settings.dungeonChannelId;
  if (!channelId) throw new Error("No configured dungeon results channel");
  const commands = await rest.get(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID)) as RESTGetAPIApplicationGuildCommandsResult;
  const dungeon = commands.find(command => command.name === "dungeon");
  if (!dungeon?.options?.some(option => option.name === "rules")) throw new Error("Deploy and register /dungeon rules first");
  const embed = dungeonScoringGuide(dungeonConfig(settings.dungeonConfig), lang).setFooter({ text: marker }).toJSON();
  const pins = await rest.get(Routes.channelPins(channelId)) as APIMessage[];
  const recent = await rest.get(Routes.channelMessages(channelId), { query: new URLSearchParams({ limit: "100" }) }) as APIMessage[];
  const existing = [...pins, ...recent].find(message => message.author.id === config.DISCORD_CLIENT_ID
    && message.embeds.some(value => value.footer?.text === marker));
  const body = { embeds: [embed], allowed_mentions: { parse: [] } };
  const message = existing
    ? await rest.patch(Routes.channelMessage(channelId, existing.id), { body }) as APIMessage
    : await rest.post(Routes.channelMessages(channelId), { body }) as APIMessage;
  if (!message.pinned) await rest.put(Routes.channelPin(channelId, message.id));
  if (settings.dungeonSignupChannelId) {
    const guides = await rest.get(Routes.channelPins(settings.dungeonSignupChannelId)) as APIMessage[];
    const guide = guides.find(value => value.author.id === config.DISCORD_CLIENT_ID
      && JSON.stringify(value.components).includes(DUNGEON_GUIDE_CREATE_ID));
    if (guide) await rest.patch(Routes.channelMessage(settings.dungeonSignupChannelId, guide.id), {
      body: { content: dungeonSignupGuideText(lang), allowed_mentions: { parse: [] } }
    });
  }
  const verified = await rest.get(Routes.channelMessage(channelId, message.id)) as APIMessage;
  if (!verified.pinned || verified.embeds[0]?.footer?.text !== marker) throw new Error("Posted guide verification failed");
  console.log(JSON.stringify({ commandRegistered: true, pinned: verified.pinned,
    url: `https://discord.com/channels/${config.DISCORD_GUILD_ID}/${channelId}/${message.id}` }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Scoring guide publication failed");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
