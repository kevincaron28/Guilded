import { createHash } from "node:crypto";
import { guildWhere } from "./guild-scope.js";
import { REST, Routes, ChannelType, PermissionFlagsBits, EmbedBuilder, escapeMarkdown, ButtonBuilder, ButtonStyle, ActionRowBuilder, type APIChannel, type APIGuildCategoryChannel, type APIGuildTextChannel, type APIMessage, type APIGuildMember, type APIUser } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { BRAND } from "../brand.js";
import { asLang, type Lang } from "../i18n.js";
import { COMMUNITY_CHANNEL_SPECS, communityChannelNames } from "../setup-names.js";
import { standings, type Standing } from "./community-rules.js";
import { communitySeasonLabel } from "./community-display.js";
import { boardWindow, breakdownOf, loadInGamePoints, mergeStandings, type MergedStanding } from "./community-ingame.js";
import { moveColumn, moveFields, trackRanks, type Movements } from "./ladder-snapshots.js";
import { altTextOf, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";
import { communityHubButton, communityHubCard, COMMUNITY_HUB_MARKER } from "./community-panels.js";
import { POE_TRACKING_ENABLED } from "../../companion/active-games.mjs";

export const COMMUNITY_BOARD_MARKER = "Guilded · Community podium";
export const COMMUNITY_CARD_PREFIX = "community-board-";
const CARD_TOP = 25, TEXT_TOP = 10;
/** A standing as the board holds it: the ledger's, plus the split between Discord, dungeons and PvP once in-game points are merged in. */
export type BoardRow = Standing & Partial<Pick<MergedStanding, "discord" | "dungeons" | "pvp">>;

/** A pinned guide's text without the PoE 2 mention while PoE 2 tracking is off (unchanged otherwise, or when not found). */
export function withoutHiddenGames(text: string, poeTracking = POE_TRACKING_ENABLED): string {
  if (poeTracking) return text;
  return text.replace("Les saisons Discord, WoW et PoE 2 restent séparées.", "Les saisons Discord et WoW restent séparées.")
    .replace("Discord, WoW and PoE 2 seasons stay separate.", "Discord and WoW seasons stay separate.");
}
export const COMMUNITY_BOARD_NAMES = ["🏆・leaderboard", "🏆-leaderboard", "leaderboard", "community-standings", "classement"];
const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const nameCache = new Map<string, { name: string; expiresAt: number }>();
const NAME_CACHE_MS = 6 * 60 * 60_000;

export function communityLeaderboardCard(input: {
  lang: Lang; discordId: string; season: { id: string; name: string; number?: number; status: string } | null;
  board: BoardRow[]; names?: ReadonlyMap<string, string>; activitiesId?: string | undefined; chatId?: string | undefined; image?: string | undefined;
}) {
  const { lang, season, board } = input;
  const active = season?.status === "ACTIVE";
  const points = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");
  const ranked = board.filter(row => row.points > 0);
  const top = ranked.slice(0, TEXT_TOP);
  const podium = new EmbedBuilder().setColor(BRAND.color)
    .setTitle(say(lang, "🏆 THE COMMUNITY PODIUM", "🏆 LE PODIUM DE LA GANG"))
    .setDescription(say(lang,
      "Every game night, helping hand and challenge makes this community stronger, and so does every dungeon, battleground and duel. **Your next point starts here.**\n💬 Discord · 🏰 Dungeons · ⚔️ PvP (battlegrounds, duels, open world)",
      "Une soirée, un coup de main, un défi, mais aussi chaque donjon, champ de bataille et duel : c’est la gang qui fait vivre la communauté. **Ta prochaine place au classement commence ici !**\n💬 Discord · 🏰 Donjons · ⚔️ JcJ (champs de bataille, duels, monde ouvert)"))
    .addFields({ name: season ? `${active ? "🟢" : "🏁"} ${escapeMarkdown(communitySeasonLabel(season, lang))}` : say(lang, "✨ The next season is coming", "✨ La prochaine saison s’en vient"),
      value: top.map(row => {
        const rank = 1 + ranked.filter(other => other.points > row.points).length;
        const name = input.names?.get(row.userId) || say(lang, `Member …${row.userId.slice(-4)}`, `Membre …${row.userId.slice(-4)}`);
        const split = row.discord === undefined ? "" : ` · 💬 ${points(row.discord)} · 🏰 ${points(row.dungeons ?? 0)} · ⚔️ ${points(row.pvp ?? 0)}`;
        return `${["🥇", "🥈", "🥉"][rank - 1] ?? `**${rank}.**`} **${escapeMarkdown(name.replace(/[\r\n]/g, " ").slice(0, split ? 24 : 32))}** — **${points(row.points)} pts**${split}`;
      }).join("\n") || say(lang, "The podium is open. Be the first to earn points!", "Le podium est libre. Qui va ouvrir le bal ?"), inline: false })
    .addFields({ name: say(lang, "🤝 Together, we’ve earned", "🤝 Les efforts de la gang"),
      value: `${points(ranked.length)} ${say(lang, "participants", "participants")} · **${points(ranked.reduce((total, row) => total + row.points, 0))} pts**`, inline: false })
    .setFooter({ text: `${COMMUNITY_BOARD_MARKER} · ${say(lang, "Ties share a rank · Earned points, not wallet balance", "Ex æquo = même rang · Points gagnés, pas le solde")}` });
  if (input.image && top.length) podium.setImage(`attachment://${input.image}`);

  const guide = new EmbedBuilder().setColor(0x2b8a78)
    .setTitle(say(lang, "✨ TAKE YOUR PLACE", "✨ À TOI DE JOUER"))
    .setDescription(say(lang, "You can join halfway through a season. Pick one activity and make your first move.", "Même si la saison est commencée, tu peux embarquer. Choisis une activité et lance-toi !"))
    .addFields({ name: say(lang, "🎲 A little luck, every day", "🎲 Ta chance du jour"),
      value: active ? say(lang, "Click Roll the dice below. One roll per day: **+2 pts**, or **+5 pts** on 90–100. Existing rounds keep their saved rewards.", "Clique sur Lancer le dé ci-dessous. Un lancer par jour : **+2 pts**, ou **+5 pts** sur 90–100. Les rondes existantes gardent leurs gains.") : say(lang, "Daily dice return with the next active Discord season.", "Les dés quotidiens reviennent avec la prochaine saison Discord.") })
    .addFields({ name: say(lang, "🎮 Play, help, celebrate", "🎮 Joue, aide, participe"), value: say(lang,
      "Join gaming nights, answer quizzes and complete challenges. Attendance and challenge evidence are confirmed by organizers.\nChat, reactions and shared voice time earn points only when participation rewards are enabled; check `/participation status`.",
      "Rejoins les soirées, réponds aux quiz et relève les défis. Un organisateur confirme les présences et les preuves des défis.\nLes messages, réactions et moments en vocal rapportent des points quand les récompenses de participation sont activées : `/participation status`.") })
    .addFields({ name: say(lang, "📊 Your next step", "📊 Suis ta progression"), value: season
      ? say(lang, "My points shows your score, available balance and participation progress privately. Spending lottery points keeps your earned score intact.", "Mes points affiche ton score, ton solde et ta participation en privé. Dépenser des points dans une loterie ne diminue pas ton score gagné.")
      : say(lang, "An organizer starts the season with `/organize start-season`. No points or prizes are awarded until activities are configured.", "Un organisateur lance la saison avec `/organize start-season`. Les activités annoncent leurs points et leurs récompenses.") })
    .setFooter({ text: say(lang, "Good company beats spam. Every genuine contribution counts. Guilded ⚜️", "Du bon temps, pas du spam. Chaque vraie contribution compte. Guilded ⚜️") });
  const links = new ActionRowBuilder<ButtonBuilder>();
  for (const [id, label] of [[input.activitiesId, say(lang, "🎮 Join an activity", "🎮 Voir les activités")], [input.chatId, say(lang, "💬 Meet the community", "💬 Rejoindre la gang")]]) {
    if (id) links.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label!).setURL(`https://discord.com/channels/${input.discordId}/${id}`));
  }
  const actions = season ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
    communityHubButton("dice", season.id, say(lang, "🎲 Roll the dice", "🎲 Lancer le dé"), true).setDisabled(!active),
    communityHubButton("wallet", season.id, say(lang, "📊 My points", "📊 Mes points")),
    communityHubButton("board", season.id, say(lang, "🏆 Full rankings", "🏆 Classement complet")),
    communityHubButton("archives", season.id, say(lang, "📚 Seasons", "📚 Saisons"))).toJSON()] : [];
  return { content: "", embeds: [podium.toJSON(), guide.toJSON()], components: [...actions, ...(links.components.length ? [links.toJSON()] : [])], allowed_mentions: { parse: [] as string[] } };
}

/**
 * The podium's picture (the shared ladder layout, drawn in the banner-and-body style by card-next.ts): rank with the medals for the
 * top 3, the member, the Discord / dungeons / PvP split in small figures, the total in gold and the "since yesterday" arrows.
 */
export function communityBoardCard(input: { lang: Lang; season: { name: string; number?: number; status: string } | null; board: BoardRow[]; names: ReadonlyMap<string, string>;
  moves?: Movements | null; updatedAt?: Date }): ScoreCard {
  const { lang, season } = input, fr = lang === "fr";
  const ranked = input.board.filter(row => row.points > 0);
  const label = season ? communitySeasonLabel({ name: season.name, ...(season.number === undefined ? {} : { number: season.number }) }, lang) : fr ? "4 dernières semaines" : "Last 4 weeks";
  const figure = (value: number) => value.toLocaleString(fr ? "fr-CA" : "en-CA");
  return {
    eyebrow: fr ? "Guilded · Communauté" : "Guilded · Community", title: fr ? "Classement de la communauté" : "Community leaderboard",
    subtitle: fr ? `${label} · ${ranked.length} membres` : `${label} · ${ranked.length} members`,
    backdrop: { kind: "board", key: "community", fallbackKey: "season-podium" }, stats: [],
    footer: fr ? "Discord, donjons, duels, champs de bataille et JcJ en monde ouvert : tout compte au même classement." : "Discord, dungeons, duels, battlegrounds and open-world PvP all count on the same board.",
    ladder: {
      meta: ladderMeta(lang, input.updatedAt ?? new Date(), null),
      empty: fr ? "Aucun point pour le moment." : "No points yet.",
      columns: [{ label: "Discord", width: 64 }, { label: fr ? "Donjons" : "Dungeons", width: 70 }, { label: fr ? "JcJ" : "PvP", width: 56 },
        { label: "Total", width: 70, primary: true }, ...(input.moves ? [moveColumn(lang)] : [])],
      boards: [{ rows: ranked.slice(0, CARD_TOP).map(row => {
        const split = breakdownOf(row), rank = 1 + ranked.filter(other => other.points > row.points).length;
        const name = (input.names.get(row.userId) || (fr ? `Membre …${row.userId.slice(-4)}` : `Member …${row.userId.slice(-4)}`)).replace(/[\r\n]/g, " ");
        return { rank, name, color: "#f3ead2", values: [figure(split.discord), figure(split.dungeons), figure(split.pvp), figure(row.points), ""], ...moveFields(input.moves, row.userId, lang) };
      }) }]
    }
  };
}

export function communityAudience(channel: { permission_overwrites?: { id: string; type: number; allow: string; deny: string }[] }, botId: string): string {
  return (channel.permission_overwrites ?? []).filter(o => o.id !== botId).map(o => `${o.type}:${o.id}:${BigInt(o.allow) & PermissionFlagsBits.ViewChannel}:${BigInt(o.deny) & PermissionFlagsBits.ViewChannel}`).filter(s => !s.endsWith(":0:0")).sort().join("|");
}

async function updateHubMessage(rest: REST, channelId: string, botId: string, body: ReturnType<typeof communityHubCard>) {
  const pins = await rest.get(Routes.channelMessagesPins(channelId)) as { items: { message: APIMessage }[] };
  const matches = (m: APIMessage) => m.author.id === botId && m.embeds.some(e => e.footer?.text === COMMUNITY_HUB_MARKER || e.footer?.text === "Guilded 5.0 setup activities");
  let message = pins.items.map(i => i.message).find(matches);
  if (!message) {
    const recent = await rest.get(Routes.channelMessages(channelId), { query: new URLSearchParams({ limit: "100" }) }) as APIMessage[];
    message = recent.find(matches);
  }
  if (message) {
    if (JSON.stringify({ embeds: message.embeds, components: message.components }) !== JSON.stringify({ embeds: body.embeds, components: body.components })) await rest.patch(Routes.channelMessage(channelId, message.id), { body });
  } else message = await rest.post(Routes.channelMessages(channelId), { body: { ...body, nonce: `ch:${channelId}`, enforce_nonce: true } }) as APIMessage;
  if (!pins.items.some(i => i.message.id === message!.id)) await rest.put(Routes.channelMessagesPin(channelId, message.id));
}

// REST maintenance shares the exact rendering used by the existing live bot.
// Only an explicit provisioning call may rename/create a channel; periodic refresh never does.
export async function updateCommunityLeaderboard(rest: REST, database: PrismaClient, discordId: string, botId: string,
  provision?: { categoryId: string }) {
  const channels = await rest.get(Routes.guildChannels(discordId)) as APIChannel[];
  const record = await database.guild.findUnique({ where: guildWhere(discordId), include: { settings: true } });
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
  const activityChannels = channels.filter((c): c is APIGuildTextChannel<ChannelType.GuildText> => c.type === ChannelType.GuildText && c.parent_id === category.id && communityChannelNames("activities").includes(c.name));
  const hub = activityChannels.length === 1 && communityAudience(activityChannels[0]!, botId) === communityAudience(channel, botId) ? activityChannels[0] : undefined;
  // A hub-hosted season is eligible only when its visibility matches the podium.
  const season = await database.communitySeason.findFirst({ where: { guildId: record.id, channelId: hub ? { in: [channel.id, hub.id] } : channel.id, game: "DISCORD", audienceRoleId: null }, orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }] });
  // Discord points from the ledger (or the frozen standings of a closed season) plus the in-game points of the same window. A failed
  // in-game read never takes the board down: it falls back to the Discord points alone.
  const base: Standing[] = season ? season.status === "ENDED" ? (season.finalStandings ?? []) as unknown as Standing[]
    : standings(await database.communityPoint.findMany({ where: { seasonId: season.id }, select: { userId: true, kind: true, amount: true } })) : [];
  let board: BoardRow[] = base;
  if (!season || season.status !== "ENDED") {
    try {
      const { since, until } = boardWindow(season);
      board = mergeStandings(base, await loadInGamePoints(database, record.id, since, until));
    } catch (error) { console.error("Community board: in-game points unavailable", error); }
  }
  // Embed mentions depend on each reader's client cache. Render actual names so
  // uncached and departed members remain readable, without pinging anyone.
  const names = new Map<string, string>();
  const topIds = board.filter(row => row.points > 0).slice(0, CARD_TOP).map(row => row.userId);
  const missing = topIds.filter(id => {
    const cached = nameCache.get(`${discordId}:${id}`);
    if (cached && cached.expiresAt > Date.now()) { names.set(id, cached.name); return false; }
    return true;
  });
  if (missing.length) {
    const saved = await database.member.findMany({ where: { guildId: record.id, discordUserId: { in: missing } }, select: { discordUserId: true, displayName: true } });
    for (const member of saved) names.set(member.discordUserId, member.displayName);
    for (const id of missing) {
      const member = await rest.get(Routes.guildMember(discordId, id)).catch(() => null) as APIGuildMember | null;
      const user = member?.user ?? (await rest.get(Routes.user(id)).catch(() => null) as APIUser | null);
      const name = member?.nick || user?.global_name || user?.username;
      if (name) names.set(id, name);
      if (nameCache.size >= 1000) nameCache.delete(nameCache.keys().next().value!);
      nameCache.set(`${discordId}:${id}`, { name: names.get(id) ?? "", expiresAt: Date.now() + NAME_CACHE_MS });
    }
  }
  const sibling = (key: "activities" | "chat") => channels.find(c => c.type === ChannelType.GuildText && c.parent_id === category.id && communityChannelNames(key).includes(c.name ?? ""))?.id;
  const ranked = board.filter(row => row.points > 0);
  const moves = ranked.length ? await trackRanks(database, record.id, `community:${season?.id ?? "recent"}`.slice(0, 120), ranked.map(row => row.userId)) : null;
  const cardInput = { lang, season, board, names, moves };
  const png = ranked.length ? await scoreCardPng(communityBoardCard(cardInput)).catch(() => null) : null;
  // The file name carries a hash of what the card shows, so a changed card is a new file and an unchanged one is never re-sent.
  const shown = JSON.stringify(ranked.slice(0, CARD_TOP).map(row => [row.userId, names.get(row.userId) ?? "", row.points, breakdownOf(row), moves?.get(row.userId) ?? null]));
  const file = png ? `${COMMUNITY_CARD_PREFIX}${createHash("sha256").update(`${lang}|${season?.id ?? ""}|${shown}`).digest("hex").slice(0, 12)}.png` : undefined;
  const body = communityLeaderboardCard({ lang, discordId, season, board, names, activitiesId: sibling("activities"), chatId: sibling("chat"), image: file });
  const plain = (embeds: { image?: unknown }[]) => embeds.map(embed => { const copy = { ...embed }; delete copy.image; return copy; });
  const pins = await rest.get(Routes.channelMessagesPins(channel.id)) as { items: { message: APIMessage }[] };
  let message = pins.items.map(item => item.message).find(m => m.author.id === botId && m.embeds.some(e => e.footer?.text.startsWith(COMMUNITY_BOARD_MARKER)));
  if (!message) {
    const recent = await rest.get(Routes.channelMessages(channel.id), { query: new URLSearchParams({ limit: "100" }) }) as APIMessage[];
    message = recent.find(m => m.author.id === botId && m.embeds.some(e => e.footer?.text.startsWith(COMMUNITY_BOARD_MARKER)));
  }
  const attachments = file && png ? [{ id: 0, filename: file, description: altTextOf(png) }] : [];
  const upload = file && png ? { files: [{ name: file, data: png }] } : {};
  if (message) {
    const sameFile = (message.attachments ?? []).map(a => a.filename).join() === (file ?? "");
    const same = sameFile && JSON.stringify({ embeds: plain(message.embeds), components: message.components }) === JSON.stringify({ embeds: plain(body.embeds), components: body.components });
    if (!same) await rest.patch(Routes.channelMessage(channel.id, message.id), { body: { ...body, ...(sameFile ? {} : { attachments }) }, ...(sameFile ? {} : upload) });
  } else message = await rest.post(Routes.channelMessages(channel.id), { body: { ...body, attachments, nonce: `cp:${channel.id}`, enforce_nonce: true }, ...upload }) as APIMessage;
  if (!pins.items.some(item => item.message.id === message!.id)) await rest.put(Routes.channelMessagesPin(channel.id, message.id));
  // The older pinned guide ("Classements et participation", written once in October) names PoE 2 seasons. While PoE 2
  // tracking is off, that sentence drops PoE 2; nothing else in the guide changes.
  for (const item of pins.items) {
    const old = item.message, embed = old.embeds[0];
    const fixed = embed?.description ? withoutHiddenGames(embed.description) : null;
    if (old.author.id !== botId || old.embeds.length !== 1 || !fixed || fixed === embed!.description) continue;
    await rest.patch(Routes.channelMessage(channel.id, old.id), { body: { embeds: [{ ...embed, description: fixed }] } }).catch(() => undefined);
  }
  if (provision) {
    for (const item of pins.items) {
      if (item.message.id !== message.id && item.message.author.id === botId && item.message.embeds.some(e => e.title === "Classements et participation")) {
        // Keep the old message and its history, while featuring the new podium.
        await rest.delete(Routes.channelMessagesPin(channel.id, item.message.id));
      }
    }
  }
  if (hub) {
    const participation = season ? await database.communityParticipationConfig.findUnique({ where: { seasonId: season.id } }) : null;
    await updateHubMessage(rest, hub.id, botId, communityHubCard(season, lang, season?.status === "ACTIVE" && !!participation?.enabled));
  }
  return { channelId: channel.id, messageId: message.id };
}
