import { REST, Routes, ChannelType, PermissionFlagsBits, EmbedBuilder, escapeMarkdown, ButtonBuilder, ButtonStyle, ActionRowBuilder, type APIChannel, type APIGuildCategoryChannel, type APIGuildTextChannel, type APIMessage } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { BRAND } from "../brand.js";
import { asLang, type Lang } from "../i18n.js";
import { COMMUNITY_CHANNEL_SPECS } from "../setup-names.js";
import { standings, type Standing } from "./community-rules.js";

export const COMMUNITY_BOARD_MARKER = "Guilded · Community podium";
export const COMMUNITY_BOARD_NAMES = ["🏆・leaderboard", "🏆-leaderboard", "leaderboard", "community-standings", "classement"];
const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;

export function communityLeaderboardCard(input: {
  lang: Lang; discordId: string; season: { id: string; name: string; status: string } | null;
  board: Standing[]; activitiesId?: string | undefined; chatId?: string | undefined;
}) {
  const { lang, season, board } = input;
  const active = season?.status === "ACTIVE";
  const points = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");
  const ranked = board.filter(row => row.points > 0);
  const top = ranked.slice(0, 10);
  const podium = new EmbedBuilder().setColor(BRAND.color)
    .setTitle(say(lang, "🏆 THE COMMUNITY PODIUM", "🏆 LE PODIUM DE LA GANG"))
    .setDescription(say(lang,
      "Every game night, helping hand and challenge makes this community stronger. **Your next point starts here.**",
      "Une soirée, un coup de main, un défi : c’est la gang qui fait vivre la communauté. **Ta prochaine place au classement commence ici !**"))
    .addFields({ name: season ? `${active ? "🟢" : "🏁"} ${escapeMarkdown(season.name)}` : say(lang, "✨ The next season is coming", "✨ La prochaine saison s’en vient"),
      value: top.map(row => {
        const rank = 1 + ranked.filter(other => other.points > row.points).length;
        return `${["🥇", "🥈", "🥉"][rank - 1] ?? `**${rank}.**`} <@${row.userId}> — **${points(row.points)} pts**`;
      }).join("\n") || say(lang, "The podium is open. Be the first to earn points!", "Le podium est libre. Qui va ouvrir le bal ?"), inline: false })
    .addFields({ name: say(lang, "🤝 Together, we’ve earned", "🤝 Les efforts de la gang"),
      value: `${points(ranked.length)} ${say(lang, "participants", "participants")} · **${points(ranked.reduce((total, row) => total + row.points, 0))} pts**`, inline: false })
    .setFooter({ text: `${COMMUNITY_BOARD_MARKER} · ${say(lang, "Ties share a rank · Earned points, not wallet balance", "Ex æquo = même rang · Points gagnés, pas le solde")}` });

  const guide = new EmbedBuilder().setColor(0x2b8a78)
    .setTitle(say(lang, "✨ TAKE YOUR PLACE", "✨ À TOI DE JOUER"))
    .setDescription(say(lang, "You can join halfway through a season. Pick one activity and make your first move.", "Même si la saison est commencée, tu peux embarquer. Choisis une activité et lance-toi !"))
    .addFields({ name: say(lang, "🎲 A little luck, every day", "🎲 Ta chance du jour"),
      value: active ? `\`/community dice season:${season!.id}\`\n${say(lang, "One roll per day: **+5 pts**, or **+15 pts** on a roll of 90–100.", "Un lancer par jour : **+5 pts**, ou **+15 pts** si tu fais 90–100.")}` : say(lang, "Daily dice return with the next active Discord season.", "Les dés quotidiens reviennent avec la prochaine saison Discord.") })
    .addFields({ name: say(lang, "🎮 Play, help, celebrate", "🎮 Joue, aide, participe"), value: say(lang,
      "Join gaming nights, answer quizzes and complete challenges. Attendance and challenge evidence are confirmed by organizers.\nChat, reactions and shared voice time earn points only when participation rewards are enabled; check `/participation status`.",
      "Rejoins les soirées, réponds aux quiz et relève les défis. Un organisateur confirme les présences et les preuves des défis.\nLes messages, réactions et moments en vocal rapportent des points quand les récompenses de participation sont activées : `/participation status`.") })
    .addFields({ name: say(lang, "📊 Your next step", "📊 Suis ta progression"), value: season
      ? `\`/community wallet season:${season.id}\`\n\`/community leaderboard season:${season.id}\`\n${say(lang, "These commands show your current points and the full rankings. Spending points in a lottery keeps your earned score intact.", "Ces commandes affichent tes points actuels et le classement complet. Dépenser des points dans une loterie ne diminue pas ton score gagné.")}`
      : say(lang, "An organizer starts the season with `/community start-season`. No points or prizes are awarded until activities are configured.", "Un organisateur lance la saison avec `/community start-season`. Les activités annoncent leurs points et leurs récompenses.") })
    .setFooter({ text: say(lang, "Good company beats spam. Every genuine contribution counts. Guilded ⚜️", "Du bon temps, pas du spam. Chaque vraie contribution compte. Guilded ⚜️") });
  const links = new ActionRowBuilder<ButtonBuilder>();
  for (const [id, label] of [[input.activitiesId, say(lang, "🎮 Join an activity", "🎮 Voir les activités")], [input.chatId, say(lang, "💬 Meet the community", "💬 Rejoindre la gang")]]) {
    if (id) links.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label!).setURL(`https://discord.com/channels/${input.discordId}/${id}`));
  }
  return { content: "", embeds: [podium.toJSON(), guide.toJSON()], components: links.components.length ? [links.toJSON()] : [], allowed_mentions: { parse: [] as string[] } };
}

// REST maintenance shares the exact rendering used by the existing live bot.
// Only an explicit provisioning call may rename/create a channel; periodic refresh never does.
export async function updateCommunityLeaderboard(rest: REST, database: PrismaClient, discordId: string, botId: string,
  provision?: { categoryId: string }) {
  const channels = await rest.get(Routes.guildChannels(discordId)) as APIChannel[];
  const record = await database.guild.findUnique({ where: { discordId }, include: { settings: true } });
  if (!record) return null;
  const lang = asLang(record.settings?.language);
  const categories = channels.filter((c): c is APIGuildCategoryChannel => c.type === ChannelType.GuildCategory && /community|communaut/i.test(c.name ?? ""));
  const category = provision ? channels.find((c): c is APIGuildCategoryChannel => c.id === provision.categoryId && c.type === ChannelType.GuildCategory) : categories.length === 1 ? categories[0] : undefined;
  if (!category) { if (provision) throw new Error("Community category not found"); return null; }
  const candidates = channels.filter((c): c is APIGuildTextChannel<ChannelType.GuildText> => c.type === ChannelType.GuildText && c.parent_id === category.id && COMMUNITY_BOARD_NAMES.includes(c.name ?? ""));
  if (candidates.length > 1) throw new Error("Multiple community leaderboard channels; choose one before updating");
  let channel = candidates[0];
  if (provision) {
    const spec = COMMUNITY_CHANNEL_SPECS[lang].standings;
    // Preserve category visibility; make only this board read-only for members.
    const overwrites = (channel?.permission_overwrites ?? category.permission_overwrites ?? []).map(o => ({ ...o }));
    let everyone = overwrites.find(o => o.id === discordId);
    if (!everyone) { everyone = { id: discordId, type: 0, allow: "0", deny: "0" }; overwrites.push(everyone); }
    everyone.allow = (BigInt(everyone.allow) & ~PermissionFlagsBits.SendMessages).toString();
    everyone.deny = (BigInt(everyone.deny) | PermissionFlagsBits.SendMessages).toString();
    for (const overwrite of overwrites) {
      if (overwrite.id !== botId) overwrite.allow = (BigInt(overwrite.allow) & ~PermissionFlagsBits.SendMessages).toString();
    }
    const bot = overwrites.find(o => o.id === botId && o.type === 1);
    const required = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.PinMessages;
    if (bot) { bot.allow = (BigInt(bot.allow) | required).toString(); bot.deny = (BigInt(bot.deny) & ~required).toString(); }
    else overwrites.push({ id: botId, type: 1, allow: required.toString(), deny: "0" });
    const body = { name: spec.name, topic: spec.topic, permission_overwrites: overwrites };
    channel = channel ? await rest.patch(Routes.channel(channel.id), { body }) as APIGuildTextChannel<ChannelType.GuildText>
      : await rest.post(Routes.guildChannels(discordId), { body: { ...body, type: ChannelType.GuildText, parent_id: category.id } }) as APIGuildTextChannel<ChannelType.GuildText>;
  }
  if (!channel) return null;
  // Never publish a role-restricted or differently visible season into this board.
  const season = await database.communitySeason.findFirst({ where: { guildId: record.id, channelId: channel.id, game: "DISCORD", audienceRoleId: null }, orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }] });
  const board = season ? season.status === "ENDED" ? (season.finalStandings ?? []) as unknown as Standing[]
    : standings(await database.communityPoint.findMany({ where: { seasonId: season.id } })) : [];
  const sibling = (key: "activities" | "chat") => channels.find(c => c.type === ChannelType.GuildText && c.parent_id === category.id && [COMMUNITY_CHANNEL_SPECS.en[key].name, COMMUNITY_CHANNEL_SPECS.fr[key].name].includes(c.name ?? ""))?.id;
  const body = communityLeaderboardCard({ lang, discordId, season, board, activitiesId: sibling("activities"), chatId: sibling("chat") });
  const pins = await rest.get(Routes.channelMessagesPins(channel.id)) as { items: { message: APIMessage }[] };
  let message = pins.items.map(item => item.message).find(m => m.author.id === botId && m.embeds.some(e => e.footer?.text.startsWith(COMMUNITY_BOARD_MARKER)));
  if (!message) {
    const recent = await rest.get(Routes.channelMessages(channel.id), { query: new URLSearchParams({ limit: "100" }) }) as APIMessage[];
    message = recent.find(m => m.author.id === botId && m.embeds.some(e => e.footer?.text.startsWith(COMMUNITY_BOARD_MARKER)));
  }
  if (message) {
    if (JSON.stringify({ embeds: message.embeds, components: message.components }) !== JSON.stringify({ embeds: body.embeds, components: body.components })) await rest.patch(Routes.channelMessage(channel.id, message.id), { body });
  } else message = await rest.post(Routes.channelMessages(channel.id), { body: { ...body, nonce: `cp:${channel.id}`, enforce_nonce: true } }) as APIMessage;
  if (!pins.items.some(item => item.message.id === message!.id)) await rest.put(Routes.channelMessagesPin(channel.id, message.id));
  if (provision) {
    for (const item of pins.items) {
      if (item.message.id !== message.id && item.message.author.id === botId && item.message.embeds.some(e => e.title === "Classements et participation")) {
        // Keep the old message and its history, while featuring the new podium.
        await rest.delete(Routes.channelMessagesPin(channel.id, item.message.id));
      }
    }
  }
  return { channelId: channel.id, messageId: message.id };
}
