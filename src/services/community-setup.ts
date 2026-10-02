import { ChannelType, PermissionFlagsBits, type Guild as DiscordGuild, type OverwriteResolvable, type REST } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { BRAND } from "../brand.js";
import type { Lang } from "../i18n.js";
import { isPermissionRoleName } from "../permissions.js";
import { COMMUNITY_CATEGORY_NAMES, COMMUNITY_CHANNEL_SPECS } from "../setup-names.js";
import { createCommunityService } from "./community.js";
import { communityMonthName } from "./community-display.js";
import { COMMUNITY_BOARD_NAMES, updateCommunityLeaderboard } from "./community-leaderboard.js";
import { createParticipationService } from "./participation.js";
import { participationRules } from "./participation-rules.js";

// The community section of /setup: one category with the activities hub, the podium and a chat,
// a first Discord season and participation rewards with the default rules. Everything already
// there is reused and left as it is: an existing season keeps its name and channels, and
// participation settings an officer chose are never overwritten.

const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const COMMUNITY_CATEGORY = /community|communaut/i;
const NO_POSTING = PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads;
const BOT_HUB = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.PinMessages;

export interface CommunitySetupState { season: boolean; participation: boolean }

// For the /setup checklist: is there a Discord season open to everyone, and does it earn points?
export async function communitySetupState(database: PrismaClient, guildId: string): Promise<CommunitySetupState> {
  const season = await database.communitySeason.findFirst({ where: { guildId, game: "DISCORD", status: "ACTIVE", audienceRoleId: null }, include: { participation: true } });
  return { season: !!season, participation: !!season?.participation?.enabled };
}

type Refresh = typeof updateCommunityLeaderboard;

export async function ensureCommunitySetup(guild: DiscordGuild, database: PrismaClient, guildId: string, lang: Lang, actorId: string,
  refresh: Refresh = updateCommunityLeaderboard): Promise<string> {
  const me = guild.members.me;
  if (!me) throw new Error(say(lang, "I can't see my own member in this server yet. Try again in a moment.", "Je ne vois pas encore mon propre membre sur ce serveur. Réessayez dans un instant."));
  await guild.roles.fetch();
  await guild.channels.fetch();
  const reason = `${BRAND.name} /setup`;
  const done: string[] = [];

  const categories = guild.channels.cache.filter(channel => channel.type === ChannelType.GuildCategory && COMMUNITY_CATEGORY.test(channel.name));
  if (categories.size > 1) throw new Error(say(lang, "There are several Community categories. Keep one, then press the button again.", "Il y a plusieurs catégories Communauté. Gardez-en une, puis appuyez de nouveau sur le bouton."));
  const category = categories.first() ?? await guild.channels.create({ name: COMMUNITY_CATEGORY_NAMES[lang], type: ChannelType.GuildCategory, reason });
  if (category.type !== ChannelType.GuildCategory) throw new Error("Community category unavailable.");
  const inCategory = (names: string[]) => guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.parentId === category.id && names.includes(channel.name));
  const names = (key: "activities" | "chat") => [COMMUNITY_CHANNEL_SPECS.en[key].name, COMMUNITY_CHANNEL_SPECS.fr[key].name];

  // The hub must be seen by exactly the people who see the podium (which copies the category),
  // so it starts from the category's permissions and only takes posting away from members.
  let activities = inCategory(names("activities"));
  if (!activities) {
    const overwrites = new Map<string, { id: string; type: number; allow: bigint; deny: bigint }>();
    for (const overwrite of category.permissionOverwrites.cache.values()) overwrites.set(overwrite.id, { id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield, deny: overwrite.deny.bitfield });
    const entry = (id: string, type: number) => { const found = overwrites.get(id) ?? { id, type, allow: 0n, deny: 0n }; overwrites.set(id, found); return found; };
    const everyone = entry(guild.roles.everyone.id, 0);
    everyone.allow &= ~NO_POSTING; everyone.deny |= NO_POSTING;
    for (const role of guild.roles.cache.filter(role => isPermissionRoleName("guildMaster", role.name) || isPermissionRoleName("officer", role.name)).values()) entry(role.id, 0).allow |= PermissionFlagsBits.SendMessages;
    const bot = entry(me.id, 1);
    bot.allow |= BOT_HUB; bot.deny &= ~BOT_HUB;
    const spec = COMMUNITY_CHANNEL_SPECS[lang].activities;
    activities = await guild.channels.create({ name: spec.name, type: ChannelType.GuildText, topic: spec.topic, parent: category.id, permissionOverwrites: [...overwrites.values()] as OverwriteResolvable[], reason });
    done.push(`<#${activities.id}>`);
  }
  let chat = inCategory(names("chat"));
  if (!chat) {
    const spec = COMMUNITY_CHANNEL_SPECS[lang].chat;
    chat = await guild.channels.create({ name: spec.name, type: ChannelType.GuildText, topic: spec.topic, parent: category.id, reason });
    done.push(`<#${chat.id}>`);
  }

  // Shared voice time only counts in voice channels every member can join.
  const open = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect;
  let voice = [...guild.channels.cache.filter(channel => channel.type === ChannelType.GuildVoice && channel.id !== guild.afkChannelId
    && channel.permissionsFor(guild.roles.everyone).has(open) && channel.permissionsFor(me).has(PermissionFlagsBits.ViewChannel)).keys()];
  if (!voice.length) {
    const created = await guild.channels.create({ name: say(lang, "Community voice", "Vocal communauté"), type: ChannelType.GuildVoice, parent: category.id, reason });
    voice = [created.id];
    done.push(`<#${created.id}>`);
  }

  const rest = guild.client.rest as REST;
  const hadBoard = !!inCategory(COMMUNITY_BOARD_NAMES);
  const board = await refresh(rest, database, guild.id, me.id, { categoryId: category.id });
  if (!board) throw new Error("Community leaderboard unavailable.");
  if (!hadBoard) done.push(`<#${board.channelId}>`);

  const lines = [done.length ? say(lang, `Community: created ${done.join(", ")}.`, `Communauté : ${done.join(", ")} créé(s).`) : say(lang, "Community: the channels were already there.", "Communauté : les salons existaient déjà.")];
  const active = await database.communitySeason.findFirst({ where: { guildId, game: "DISCORD", status: "ACTIVE" }, include: { participation: true } });
  if (active?.audienceRoleId) {
    lines.push(say(lang, "The active Discord season is limited to one role, so I left it and its participation settings alone.", "La saison Discord active est réservée à un rôle : je n'ai touché ni à la saison ni à ses réglages de participation."));
    return lines.join("\n");
  }
  let season = active;
  if (!season) {
    const settings = await database.guildSettings.findUnique({ where: { guildId } });
    const community = createCommunityService(database);
    const started = await community.startSeason(guildId, { name: communityMonthName(new Date(), settings?.timezone ?? "America/Toronto", lang), game: "DISCORD", channelId: board.channelId, audienceRoleId: null, actorId });
    await community.configureSeason(guildId, started.id, actorId, { announcementChannelId: activities.id });
    season = { ...started, announcementChannelId: activities.id, participation: null };
    lines.push(say(lang, `Started the first season: ${started.name}.`, `Première saison lancée : ${started.name}.`));
  }
  if (season.participation) {
    lines.push(say(lang, "Participation rewards were already configured; I kept those settings (`/participation settings`).", "Les récompenses de participation étaient déjà configurées; j'ai gardé ces réglages (`/participation settings`)."));
  } else {
    const rules = participationRules.parse({ textChannels: [chat.id], voiceChannels: voice.slice(0, 20) });
    await createParticipationService(database).configure(guildId, season.id, true, rules);
    lines.push(say(lang,
      `Participation rewards are on with the default rules: messages in <#${chat.id}>, reactions, and shared time in ${rules.voiceChannels.length} voice channel(s). Change them with \`/participation settings\`.`,
      `Les récompenses de participation sont activées avec les règles par défaut : messages dans <#${chat.id}>, réactions, et temps partagé dans ${rules.voiceChannels.length} salon(s) vocal(aux). Modifiez-les avec \`/participation settings\`.`));
  }
  // The podium and the hub now show the season and whether participation earns points.
  await refresh(rest, database, guild.id, me.id);
  return lines.join("\n");
}
