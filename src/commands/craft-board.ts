import { cleanCharacterName } from "../services/character-display.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, type StringSelectMenuInteraction,
  type ButtonInteraction, type ForumChannel, type Guild as DiscordGuild, type GuildMember, type ModalSubmitInteraction, type ThreadChannel,
  MessageFlags,
} from "discord.js";
import type { CraftRequestStatus } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { createCraftService } from "../services/craft.js";
import { findProfessionHolders } from "../services/profession-search.js";
import { findCrafters } from "../services/recipes.js";
import { PROFESSIONS } from "../wow-data.js";
import { professionName as shownProfession } from "../services/profession-style.js";
import { professionSlug } from "../services/profession-names.js";
import { lastSeenText } from "../services/last-seen.js";
import { guildService } from "./context.js";
import { markGuildChanged } from "../services/standings-feed.js";
import { resolveItemKey, type OrderChange } from "../services/craft-orders.js";
import type { Client } from "discord.js";
import { craftNotifyList, pingCrafters, replaceCraftNotify, syncCraftChannels } from "../services/craft-channels.js";
import { recordCraftCompletion, updateCraftLadder } from "../services/craft-ladder.js";

// The craft board: a forum channel where every craft request is its own post
// with tags (profession and Open / Claimed / Done) and buttons inside the post
// (Claim, Mark done, Give back, Cancel). Members ask for a craft with the
// "Request a craft" button on the pinned guide post (a small form) or with
// /craft request; crafters filter the forum by profession tag and click. If
// the craft channel is an ordinary text channel, the old behaviour is used.

const craftService = createCraftService(prisma);
export const CRAFT_PREFIX = "craft:";

const STATUS_LABELS: Record<Lang, Record<CraftRequestStatus, string>> = {
  en: { OPEN: "🟢 Open", CLAIMED: "🟡 Claimed", DONE: "✅ Done", CANCELLED: "⛔ Cancelled" },
  fr: { OPEN: "🟢 Ouvert", CLAIMED: "🟡 Pris en charge", DONE: "✅ Terminé", CANCELLED: "⛔ Annulé" }
};
const STATUS_COLOR: Record<CraftRequestStatus, number> = { OPEN: 0x57f287, CLAIMED: 0xfee75c, DONE: 0x808080, CANCELLED: 0x808080 };
const STATUSES: CraftRequestStatus[] = ["OPEN", "CLAIMED", "DONE", "CANCELLED"];

// Profession names as shown to a French guild live in profession-style.ts (the stored value stays the English name).
export const professionLabel = (lang: Lang, profession: string): string => (profession ? shownProfession(profession, lang) : profession);
const statusLabel = (lang: Lang, status: CraftRequestStatus) => STATUS_LABELS[lang][status];

// The forum's tag names in a language: the four statuses, then the professions.
export const boardTagNames = (lang: Lang = "en"): string[] => [...STATUSES.map((status) => statusLabel(lang, status)), ...PROFESSIONS.slice(0, 16).map((name) => professionLabel(lang, name))];
// Every spelling (English or French) of the tag at a position, so switching language never adds duplicates.
const tagAliases = (index: number): string[] => [boardTagNames("en")[index] ?? "", boardTagNames("fr")[index] ?? ""];

type RequestRow = {
  id: string; item: string; quantity: number; profession: string | null; note: string | null; materialsProvided: boolean;
  status: CraftRequestStatus; createdAt: Date;
  requester: { discordUserId: string; displayName: string }; crafter: { discordUserId: string; displayName: string } | null;
  // The character that claimed it in game (craft-orders.ts), when it was claimed there.
  crafterCharacter?: string | null;
};

export function threadTitle(request: Pick<RequestRow, "status" | "quantity" | "item">): string {
  return `${STATUS_LABELS.en[request.status].split(" ")[0]} ${request.quantity}× ${request.item}`.slice(0, 100);
}

export function craftEmbed(request: RequestRow, crafters: string[], lang: Lang = "en"): EmbedBuilder {
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLOR[request.status])
    .setTitle(`🔨 ${request.quantity}× ${request.item}`.slice(0, 250))
    .addFields(
      { name: T("Status"), value: statusLabel(lang, request.status), inline: true },
      { name: T("Asked by"), value: `<@${request.requester.discordUserId}>`, inline: true },
      { name: T("Crafter"), value: request.crafter ? (request.crafterCharacter ? T("{mention} ({character}, in game)", { mention: `<@${request.crafter.discordUserId}>`, character: cleanCharacterName(request.crafterCharacter) }) : `<@${request.crafter.discordUserId}>`) : T("nobody yet"), inline: true }
    )
    .setFooter({ text: T("Request {id}", { id: request.id }) });
  if (request.profession) embed.addFields({ name: T("Profession"), value: professionLabel(lang, request.profession), inline: true });
  embed.addFields({ name: T("Materials"), value: request.materialsProvided ? T("Requester provides them") : T("Crafter's or to be arranged"), inline: true });
  if (request.note) embed.setDescription(request.note.slice(0, 1000));
  if (crafters.length && (request.status === "OPEN" || request.status === "CLAIMED")) {
    embed.addFields({ name: T("Guild {profession} crafters", { profession: professionLabel(lang, request.profession ?? "") }), value: crafters.join(", ").slice(0, 1000) });
  }
  embed.setTimestamp(request.createdAt);
  return embed;
}

function buttonsFor(request: Pick<RequestRow, "id" | "status">, lang: Lang) {
  if (request.status === "DONE" || request.status === "CANCELLED") return [];
  const T = (english: string) => tx(lang, english);
  const b = (action: string, label: string, style: ButtonStyle) => new ButtonBuilder().setCustomId(`${CRAFT_PREFIX}${request.id}:${action}`).setLabel(label).setStyle(style);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(request.status === "OPEN"
      ? [b("claim", T("I'll craft it"), ButtonStyle.Success)]
      : [b("done", T("Mark done"), ButtonStyle.Success), b("release", T("Give back"), ButtonStyle.Secondary)]),
    b("cancel", T("Cancel request"), ButtonStyle.Danger)
  )];
}

// The language of the guild's craft board.
export async function boardLang(guildId: string): Promise<Lang> {
  return asLang((await guildService.getSettings(guildId))?.language);
}

// ---------------------------------------------------------------------
// The forum
// ---------------------------------------------------------------------

export async function boardForum(discordGuild: DiscordGuild, guildId: string): Promise<ForumChannel | null> {
  const settings = await guildService.getSettings(guildId);
  if (!settings?.craftChannelId) return null;
  const channel = await discordGuild.channels.fetch(settings.craftChannelId).catch(() => null);
  return channel?.type === ChannelType.GuildForum ? channel : null;
}

// Makes sure the forum has the status and profession tags (keeps any others). A tag counts as
// present under its English or French name.
export async function ensureBoardTags(forum: ForumChannel, lang: Lang = "en"): Promise<void> {
  const wanted = boardTagNames(lang);
  const have = new Set(forum.availableTags.map((tag) => tag.name));
  const missing = wanted.filter((_name, index) => !tagAliases(index).some((alias) => have.has(alias)));
  if (missing.length === 0) return;
  const room = 20 - forum.availableTags.length;
  await forum.setAvailableTags([...forum.availableTags, ...missing.slice(0, Math.max(0, room)).map((name) => ({ name }))]);
}

export function tagIds(forum: ForumChannel, status: CraftRequestStatus, profession: string | null): string[] {
  const byName = new Map(forum.availableTags.map((tag) => [tag.name, tag.id]));
  const find = (aliases: string[]) => aliases.map((alias) => byName.get(alias)).find((id) => !!id);
  const professionIndex = profession ? PROFESSIONS.slice(0, 16).findIndex((name) => name === profession) : -1;
  return [
    find(tagAliases(STATUSES.indexOf(status))),
    professionIndex >= 0 ? find(tagAliases(STATUSES.length + professionIndex)) : undefined
  ].filter((id): id is string => !!id);
}

export const guideText = (lang: Lang = "en"): string => [
  tx(lang, "**How the craft board works**"),
  lang === "fr" ? "• `/character profession directory` : meilleurs artisans. `/craft who item:` : recettes connues. Les demandes indiquent si la recette est confirmée." : "• `/character profession directory` shows top guild crafters. `/craft who item:` finds known recipes. Requests distinguish recorded recipes from unverified skills.",
  tx(lang, "• Press **Request a craft** below (or use `/craft request`): fill in the item. It becomes its own post here."),
  tx(lang, "• Crafters: filter this forum by your profession tag, open a post and press **I'll craft it**. Press **Mark done** when it's made."),
  tx(lang, "• The post title and tag follow the status: 🟢 Open, 🟡 Claimed, ✅ Done. Finished posts lock."),
  tx(lang, "• Anyone can cancel their own request; officers can cancel or finish any."),
  tx(lang, "• Crafters: press **Crafter pings** to be mentioned when someone asks for a recipe you know.")
].join("\n");
export const GUIDE_TEXT = guideText("en");

// The guide's buttons: Request a craft, and (9.1) Crafter pings.
export const guideButtons = (lang: Lang) => [new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`${CRAFT_PREFIX}new`).setLabel(tx(lang, "Request a craft")).setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`${CRAFT_PREFIX}notify`).setLabel(tx(lang, "Crafter pings")).setStyle(ButtonStyle.Secondary))];

// Posts the pinned guide (with the "Request a craft" button) in a forum. Run once by /setup.
export async function postBoardGuide(forum: ForumChannel, lang: Lang = "en"): Promise<void> {
  await ensureBoardTags(forum, lang);
  const thread = await forum.threads.create({
    name: tx(lang, "📌 Start here: how the craft board works"),
    message: {
      content: guideText(lang),
      components: guideButtons(lang)
    }
  });
  await thread.pin().catch(() => undefined);
}

async function openThread(forum: ForumChannel, threadId: string): Promise<ThreadChannel | null> {
  const thread = await forum.threads.fetch(threadId).catch(() => null);
  if (!thread) return null;
  if (thread.archived) await thread.setArchived(false).catch(() => undefined);
  if (thread.locked) await thread.setLocked(false).catch(() => undefined);
  return thread;
}

async function loadRequest(requestId: string): Promise<RequestRow & { threadId: string | null; guildId: string; requesterId: string; crafterId: string | null; doneAt: Date | null }> {
  return prisma.craftRequest.findUniqueOrThrow({ where: { id: requestId }, include: { requester: true, crafter: true } });
}

async function requestCrafters(request: { guildId: string; item: string; profession: string | null }): Promise<string[]> {
  const matches = await findCrafters(prisma, request.guildId, request.item);
  const exact = matches.filter((match) => match.itemName.toLowerCase() === request.item.trim().toLowerCase() || String(match.itemKey) === request.item.trim());
  const known = exact.flatMap((match) => match.crafters).filter((crafter) => !request.profession || professionSlug(crafter.profession) === professionSlug(request.profession));
  if (known.length) return [...new Set(known.map((crafter) => `${cleanCharacterName(crafter.character)} (${crafter.profession}; recipe recorded)`))].slice(0, 10);
  if (!request.profession) return [];
  return (await findProfessionHolders(prisma, request.guildId, request.profession)).slice(0, 5).map((crafter) => `${cleanCharacterName(crafter.character)} (${crafter.skillLevel}; recipe unverified)`);
}

// Track D (request 9): a request made for one crafter pings that crafter once, in the new post. The mention is only
// sent here at creation, never again when the post is edited, and only to the one asked person (not the requester).
async function pingAskedCrafter(thread: ThreadChannel, request: RequestRow & { guildId: string }, character: string, lang: Lang): Promise<void> {
  const asked = await prisma.character.findFirst({ where: { name: { equals: character, mode: "insensitive" }, member: { guildId: request.guildId, status: "ACTIVE" } }, select: { name: true, member: { select: { discordUserId: true } } } });
  const id = asked?.member.discordUserId;
  if (!id || id === request.requester.discordUserId) return;
  await thread.send({ content: tx(lang, "<@{id}>, {requester} would like {item} from you ({character}). Press **I'll craft it** if you can.", { id, requester: request.requester.displayName, item: `${request.quantity}× ${request.item}`, character: asked.name }), allowedMentions: { users: [id] } }).catch(() => undefined);
}

// Creates the forum post for a new request. False when the craft channel is not a forum.
export async function postCraftRequest(discordGuild: DiscordGuild | null, requestId: string, askCrafter?: string): Promise<{ posted: boolean; threadId?: string }> {
  if (!discordGuild) return { posted: false };
  try {
    const request = await loadRequest(requestId);
    // Crafting orders in game: every addon's Orders page hears about the new request.
    markGuildChanged(request.guildId);
    const lang = await boardLang(request.guildId);
    const orderMessageId = await syncCraftChannels(prisma, discordGuild, request as never, lang).catch((error: unknown) => { console.warn("Craft orders channel failed", error); return null; });
    const forum = await boardForum(discordGuild, request.guildId);
    if (!forum) {
      // No forum: the pings go to #craft-orders, when there is one.
      if (!askCrafter) await pingInOrders(discordGuild, request, lang);
      return { posted: false };
    }
    await ensureBoardTags(forum, lang);
    const crafters = await requestCrafters(request);
    const thread = await forum.threads.create({
      name: threadTitle(request),
      message: { embeds: [craftEmbed(request, crafters, lang)], components: buttonsFor(request, lang), allowedMentions: { parse: [] } },
      appliedTags: tagIds(forum, request.status, request.profession)
    });
    await prisma.craftRequest.update({ where: { id: request.id }, data: { threadId: thread.id } });
    if (askCrafter) await pingAskedCrafter(thread, request, askCrafter, lang);
    else await pingCrafters(prisma, request, (content, users) => thread.send({ content, allowedMentions: { users } }), lang).catch((error: unknown) => console.warn("Crafter pings failed", error));
    // The order line now links the new post.
    if (orderMessageId) await syncCraftChannels(prisma, discordGuild, { ...request, threadId: thread.id, orderMessageId } as never, lang).catch(() => undefined);
    return { posted: true, threadId: thread.id };
  } catch (error) {
    console.error("Failed to post the craft request to the board", error);
    return { posted: false };
  }
}

async function pingInOrders(discordGuild: DiscordGuild, request: RequestRow & { guildId: string; requesterId: string }, lang: Lang): Promise<void> {
  const settings = await guildService.getSettings(request.guildId);
  const channel = settings?.craftOrdersEnabled !== false && settings?.craftOrdersChannelId ? await discordGuild.channels.fetch(settings.craftOrdersChannelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await pingCrafters(prisma, request, (content, users) => channel.send({ content, allowedMentions: { users } }), lang).catch((error: unknown) => console.warn("Crafter pings failed", error));
}

// Brings the forum post in line with the request: title, tags, embed, buttons; locks it when finished.
export async function syncCraftPost(discordGuild: DiscordGuild | null, requestId: string): Promise<void> {
  if (!discordGuild) return;
  try {
    const request = await loadRequest(requestId);
    markGuildChanged(request.guildId);
    await syncCraftChannels(prisma, discordGuild, request as never, await boardLang(request.guildId)).catch((error: unknown) => console.warn("Craft orders channel failed", error));
    // 9.1: a finished craft goes into the guild's craft history (once per request) and the Top crafters card.
    if (request.status === "DONE" && request.crafterId) {
      const added = await recordCraftCompletion(prisma, { guildId: request.guildId, crafterId: request.crafterId, item: request.item, quantity: request.quantity,
        profession: request.profession, requestId: request.id, doneAt: request.doneAt ?? new Date() }).catch((error: unknown) => { console.warn("Craft history failed", error); return false; });
      if (added) void updateCraftLadder(prisma, discordGuild);
    }
    if (!request.threadId) return;
    const forum = await boardForum(discordGuild, request.guildId);
    if (!forum) return;
    const thread = await openThread(forum, request.threadId);
    if (!thread) return;
    const lang = await boardLang(request.guildId);
    const crafters = await requestCrafters(request);
    const starter = await thread.fetchStarterMessage().catch(() => null);
    await starter?.edit({ embeds: [craftEmbed(request, crafters, lang)], components: buttonsFor(request, lang), allowedMentions: { parse: [] } });
    await thread.setName(threadTitle(request)).catch(() => undefined);
    await thread.setAppliedTags(tagIds(forum, request.status, request.profession)).catch(() => undefined);
    if (request.status === "DONE" || request.status === "CANCELLED") {
      await thread.send({ content: request.status === "DONE" ? tx(lang, "✅ Crafted by <@{id}>. Closing this post.", { id: request.crafter?.discordUserId ?? request.requester.discordUserId }) : tx(lang, "⛔ Cancelled. Closing this post."), allowedMentions: { parse: [] } }).catch(() => undefined);
      await thread.setLocked(true).catch(() => undefined);
      await thread.setArchived(true).catch(() => undefined);
    }
  } catch (error) {
    console.error("Failed to update the craft board post", error);
  }
}

// ---------------------------------------------------------------------
// Buttons and the request form
// ---------------------------------------------------------------------

export async function handleCraftButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const rest = interaction.customId.slice(CRAFT_PREFIX.length);
  if (rest === "new") {
    const settingsGuild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    await interaction.showModal(requestModal(await boardLang(settingsGuild.id)));
    return;
  }
  if (rest === "notify") {
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
    const lang = await boardLang(guild.id);
    await interaction.reply({ content: tx(lang, "Pick the professions you want pings for. You are mentioned only when someone asks for a recipe one of your characters knows, at most once every 30 minutes."),
      components: [notifyMenu(lang, await craftNotifyList(prisma, member.id))], flags: MessageFlags.Ephemeral });
    return;
  }
  if (rest.startsWith("ask:")) {
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const lang = await boardLang(guild.id);
    const found = await recipeForForm(guild.id, Number(rest.slice(4)));
    if (found === null) { await interaction.reply({ content: tx(lang, "That recipe is no longer listed."), flags: MessageFlags.Ephemeral }); return; }
    await interaction.showModal(requestModal(lang, found === "slow" ? {} : { item: found.itemName, profession: found.profession }));
    return;
  }
  const [requestId, action] = rest.split(":");
  if (!requestId || !action) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = await boardLang(guild.id);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  const isOfficer = !!interaction.member && hasPermission(interaction.member as GuildMember, "officer");
  const dm = (userId: string, text: string) => interaction.client.users.send(userId, text).catch(() => undefined);
  try {
    const summary = (r: { quantity: number; item: string }) => `${r.quantity}× **${r.item}**`;
    if (action === "claim") {
      const request = await craftService.claim(guild.id, requestId, member.id);
      await interaction.editReply({ content: T("You'll craft {item} for {name}. Press **Mark done** in the post when it's made.", { item: summary(request), name: request.requester.displayName }) });
      await dm(request.requester.discordUserId, T("🔨 {crafter} is crafting your {item}.", { crafter: request.crafter?.displayName ?? T("A guild crafter"), item: summary(request) }));
    } else if (action === "done") {
      const request = await craftService.complete(guild.id, requestId, member.id, isOfficer);
      await interaction.editReply({ content: T("Marked done: {item}.", { item: summary(request) }) });
      await dm(request.requester.discordUserId, T("✅ Your {item} is crafted by {crafter}. Check your mail or arrange a trade.", { item: summary(request), crafter: request.crafter?.displayName ?? T("a guild crafter") }));
    } else if (action === "release") {
      await craftService.release(guild.id, requestId, member.id, isOfficer);
      await interaction.editReply({ content: T("Given back: it is open again.") });
    } else if (action === "cancel") {
      const request = await craftService.cancel(guild.id, requestId, member.id, isOfficer);
      await interaction.editReply({ content: T("Request cancelled.") });
      if (request.crafter) await dm(request.crafter.discordUserId, T("The craft request for {item} was cancelled.", { item: summary(request) }));
    }
    await syncCraftPost(interaction.guild, requestId);
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : T("That didn't work.") });
  }
}

function requestModal(lang: Lang, prefill: { item?: string; profession?: string; crafter?: string | undefined } = {}) {
  const T = (english: string) => tx(lang, english);
  const input = (id: string, label: string, placeholder: string, required: boolean, style = TextInputStyle.Short, max = 100, value?: string) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) field.setValue(value.slice(0, max));
    return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
  };
  // The asked crafter rides in the form's id (Discord ids are limited to 100 characters).
  return new ModalBuilder().setCustomId(`${CRAFT_PREFIX}new-modal${prefill.crafter ? `:${prefill.crafter.slice(0, 40)}` : ""}`).setTitle(T("Request a craft")).addComponents(
    input("item", T("Item"), T("Flask of the Titans"), true, TextInputStyle.Short, 100, prefill.item),
    input("profession", T("Profession"), T("Alchemy"), false, TextInputStyle.Short, 40, prefill.profession),
    input("quantity", T("How many"), "1", false, TextInputStyle.Short, 3),
    input("note", T("Details (materials, deadline)"), T("I have the herbs"), false, TextInputStyle.Paragraph, 300)
  );
}

// The "Request a craft" form: creates the request and its post.
export async function handleCraftModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
    const typed = interaction.fields.getTextInputValue("profession").trim();
    // Match the typed profession to a known one so the tag and crafter list work.
    // The typed name may be English or French; the stored value is always the English one.
    const spellings = (name: string) => [name.toLowerCase(), professionLabel("fr", name).toLowerCase()];
    const profession = PROFESSIONS.find((name) => spellings(name).includes(typed.toLowerCase())) ?? PROFESSIONS.find((name) => typed && spellings(name).some((spelling) => spelling.startsWith(typed.toLowerCase())));
    const quantity = Number(interaction.fields.getTextInputValue("quantity") || "1");
    const item = interaction.fields.getTextInputValue("item");
    const asked = interaction.customId.split(":")[2];
    const request = await craftService.request({
      guildId: guild.id, requesterId: member.id, item, profession,
      quantity: Number.isInteger(quantity) ? quantity : 1, note: interaction.fields.getTextInputValue("note") || undefined, materialsProvided: false,
      itemKey: await resolveItemKey(prisma, guild.id, item).catch(() => null), askedCharacter: asked
    });
    const posted = await postCraftRequest(interaction.guild, request.id, asked);
    const lang = await boardLang(guild.id);
    await interaction.editReply({ content: posted.posted
      ? tx(lang, "Posted: <#{id}>. You'll get a DM when a crafter takes it.", { id: posted.threadId ?? "" })
      : tx(lang, "Request saved (ID `{id}`), but I couldn't post it to the board: check my permissions on the craft forum.", { id: request.id }) });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Could not create the request." });
  }
}

// Track D (request 9): under a profession post's Details answer (commands/profession-details.ts) a member can press
// Request, or pick one crafter to ask. Both open the ordinary request form already filled in; the crafter menu's
// choice rides in the form id and the new post mentions that crafter once.
export function requestRows(lang: Lang, itemKey: number, crafters: { character: string; skill: number | null; lastSeen: Date | null }[], now = new Date()) {
  const T = (english: string) => tx(lang, english);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${CRAFT_PREFIX}ask:${itemKey}`).setLabel(T("Request")).setStyle(ButtonStyle.Primary));
  if (!crafters.length) return [buttons];
  const who = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${CRAFT_PREFIX}askwho:${itemKey}`).setPlaceholder(T("Or request it from one crafter"))
    .addOptions(crafters.filter((crafter, index, all) => all.findIndex(other => other.character.slice(0, 40).toLowerCase() === crafter.character.slice(0, 40).toLowerCase()) === index)
      .slice(0, 25).map(crafter => ({ label: crafter.character.slice(0, 100), value: crafter.character.slice(0, 40), description: `${crafter.skill ?? "—"} · ${lastSeenText(crafter.lastSeen, lang, now)}`.slice(0, 100) }))));
  return [who, buttons];
}

/** The crafting professions a member can get pings for (gathering ones have no recipes). */
export const PING_PROFESSIONS: string[] = PROFESSIONS.filter((name) => !["Herbalism", "Mining", "Skinning", "Fishing", "Archaeology"].includes(name));

export function notifyMenu(lang: Lang, chosen: readonly string[]) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${CRAFT_PREFIX}notifypick`)
    .setPlaceholder(tx(lang, "Professions for crafter pings")).setMinValues(0).setMaxValues(PING_PROFESSIONS.length)
    .addOptions(PING_PROFESSIONS.map((name) => ({ label: professionLabel(lang, name), value: name, default: chosen.includes(name) }))));
}

export const notifyListText = (lang: Lang, list: readonly string[]) => list.length
  ? tx(lang, "Crafter pings on for: {list}.", { list: list.map((name) => professionLabel(lang, name)).join(", ") }) : tx(lang, "Crafter pings are off.");

export async function handleCraftSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.guild && interaction.customId === `${CRAFT_PREFIX}notifypick`) {
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
    const lang = await boardLang(guild.id);
    const now = await replaceCraftNotify(prisma, guild.id, member.id, interaction.values.filter((value) => PING_PROFESSIONS.includes(value)));
    await interaction.update({ content: notifyListText(lang, now), components: [notifyMenu(lang, now)] });
    return;
  }
  if (!interaction.guild || !interaction.customId.startsWith(`${CRAFT_PREFIX}askwho:`)) return;
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = await boardLang(guild.id);
  const found = await recipeForForm(guild.id, Number(interaction.customId.split(":")[2]));
  if (found === null) { await interaction.reply({ content: tx(lang, "That recipe is no longer listed."), flags: MessageFlags.Ephemeral }); return; }
  await interaction.showModal(requestModal(lang, found === "slow" ? { crafter: interaction.values[0] } : { item: found.itemName, profession: found.profession, crafter: interaction.values[0] }));
}

// A modal must be Discord's FIRST answer, within 3 seconds, and cannot be deferred. So the Request form reads only the
// one recipe row it pre-fills (an indexed lookup, not every profession post), and opens empty rather than late.
export const FORM_LOOKUP_BUDGET_MS = 1_500;
export async function recipeForForm(guildId: string, itemKey: number, budgetMs = FORM_LOOKUP_BUDGET_MS): Promise<{ itemName: string; profession: string } | null | "slow"> {
  if (!Number.isInteger(itemKey)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"slow">(resolve => { timer = setTimeout(() => resolve("slow"), budgetMs); });
  const row = prisma.recipeKnown.findFirst({ where: { guildId, itemKey }, select: { itemName: true, profession: true } }).catch(() => "slow" as const);
  try { return await Promise.race([row, slow]); } finally { clearTimeout(timer); }
}

// Crafting orders in game (docs/plans/CRAFTING_ORDERS.md): after an upload applied claims, finishes or give-backs
// made in game, the forum post follows and the requester gets the same DMs as for the Discord buttons.
export async function announceOrderChanges(client: Client, discordGuildId: string, changes: readonly OrderChange[]): Promise<void> {
  if (!changes.length) return;
  const discordGuild = await client.guilds.fetch(discordGuildId).catch(() => null);
  for (const change of changes) {
    try {
      await syncCraftPost(discordGuild, change.requestId);
      const request = await loadRequest(change.requestId);
      const lang = await boardLang(request.guildId);
      const crafter = `${request.crafter?.displayName ?? tx(lang, "A guild crafter")} (${cleanCharacterName(change.character)})`;
      const item = `${request.quantity}× **${request.item}**`;
      const text = change.action === "claim" ? tx(lang, "🔨 {crafter} is crafting your {item}.", { crafter, item })
        : change.action === "done" ? tx(lang, "✅ Your {item} is crafted by {crafter}. Check your mail or arrange a trade.", { item, crafter })
        : null;
      if (text) await client.users.send(request.requester.discordUserId, { content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
    } catch (error) {
      console.warn("Craft order update from the game failed to reach Discord", error);
    }
  }
}
