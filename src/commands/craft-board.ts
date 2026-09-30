import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ForumChannel, type Guild as DiscordGuild, type GuildMember, type ModalSubmitInteraction, type ThreadChannel
} from "discord.js";
import type { CraftRequestStatus } from "@prisma/client";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { createCraftService } from "../services/craft.js";
import { findProfessionHolders } from "../services/profession-search.js";
import { findCrafters } from "../services/recipes.js";
import { PROFESSIONS } from "../wow-data.js";
import { guildService } from "./context.js";

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

// Profession names as shown to a French guild (the stored value stays the English name).
const PROFESSION_FR: Record<string, string> = {
  Alchemy: "Alchimie", Blacksmithing: "Forge", Enchanting: "Enchantement", Engineering: "Ingénierie", Leatherworking: "Travail du cuir",
  Tailoring: "Couture", Jewelcrafting: "Joaillerie", Inscription: "Calligraphie", Herbalism: "Herboristerie", Mining: "Minage",
  Skinning: "Dépeçage", Cooking: "Cuisine", "First Aid": "Premiers soins", Fishing: "Pêche", Archaeology: "Archéologie"
};
export const professionLabel = (lang: Lang, profession: string): string => (lang === "fr" ? PROFESSION_FR[profession] ?? profession : profession);
const statusLabel = (lang: Lang, status: CraftRequestStatus) => STATUS_LABELS[lang][status];

// The forum's tag names in a language: the four statuses, then the professions.
export const boardTagNames = (lang: Lang = "en"): string[] => [...STATUSES.map((status) => statusLabel(lang, status)), ...PROFESSIONS.slice(0, 16).map((name) => professionLabel(lang, name))];
// Every spelling (English or French) of the tag at a position, so switching language never adds duplicates.
const tagAliases = (index: number): string[] => [boardTagNames("en")[index] ?? "", boardTagNames("fr")[index] ?? ""];

type RequestRow = {
  id: string; item: string; quantity: number; profession: string | null; note: string | null; materialsProvided: boolean;
  status: CraftRequestStatus; createdAt: Date;
  requester: { discordUserId: string; displayName: string }; crafter: { discordUserId: string; displayName: string } | null;
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
      { name: T("Crafter"), value: request.crafter ? `<@${request.crafter.discordUserId}>` : T("nobody yet"), inline: true }
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
async function boardLang(guildId: string): Promise<Lang> {
  return asLang((await guildService.getSettings(guildId))?.language);
}

// ---------------------------------------------------------------------
// The forum
// ---------------------------------------------------------------------

async function boardForum(discordGuild: DiscordGuild, guildId: string): Promise<ForumChannel | null> {
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

function tagIds(forum: ForumChannel, status: CraftRequestStatus, profession: string | null): string[] {
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
  tx(lang, "• Anyone can cancel their own request; officers can cancel or finish any.")
].join("\n");
export const GUIDE_TEXT = guideText("en");

// Posts the pinned guide (with the "Request a craft" button) in a forum. Run once by /setup.
export async function postBoardGuide(forum: ForumChannel, lang: Lang = "en"): Promise<void> {
  await ensureBoardTags(forum, lang);
  const thread = await forum.threads.create({
    name: tx(lang, "📌 Start here: how the craft board works"),
    message: {
      content: guideText(lang),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${CRAFT_PREFIX}new`).setLabel(tx(lang, "Request a craft")).setStyle(ButtonStyle.Primary))]
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

async function loadRequest(requestId: string): Promise<RequestRow & { threadId: string | null; guildId: string }> {
  return prisma.craftRequest.findUniqueOrThrow({ where: { id: requestId }, include: { requester: true, crafter: true } });
}

async function requestCrafters(request: { guildId: string; item: string; profession: string | null }): Promise<string[]> {
  const matches = await findCrafters(prisma, request.guildId, request.item);
  const exact = matches.filter((match) => match.itemName.toLowerCase() === request.item.trim().toLowerCase() || String(match.itemKey) === request.item.trim());
  const known = exact.flatMap((match) => match.crafters).filter((crafter) => !request.profession || crafter.profession.toLowerCase() === request.profession.toLowerCase());
  if (known.length) return [...new Set(known.map((crafter) => `${crafter.character} (${crafter.profession}; recipe recorded)`))].slice(0, 10);
  if (!request.profession) return [];
  return (await findProfessionHolders(prisma, request.guildId, request.profession)).slice(0, 5).map((crafter) => `${crafter.character} (${crafter.skillLevel}; recipe unverified)`);
}

// Creates the forum post for a new request. False when the craft channel is not a forum.
export async function postCraftRequest(discordGuild: DiscordGuild | null, requestId: string): Promise<{ posted: boolean; threadId?: string }> {
  if (!discordGuild) return { posted: false };
  try {
    const request = await loadRequest(requestId);
    const forum = await boardForum(discordGuild, request.guildId);
    if (!forum) return { posted: false };
    const lang = await boardLang(request.guildId);
    await ensureBoardTags(forum, lang);
    const crafters = await requestCrafters(request);
    const thread = await forum.threads.create({
      name: threadTitle(request),
      message: { embeds: [craftEmbed(request, crafters, lang)], components: buttonsFor(request, lang), allowedMentions: { parse: [] } },
      appliedTags: tagIds(forum, request.status, request.profession)
    });
    await prisma.craftRequest.update({ where: { id: request.id }, data: { threadId: thread.id } });
    return { posted: true, threadId: thread.id };
  } catch (error) {
    console.error("Failed to post the craft request to the board", error);
    return { posted: false };
  }
}

// Brings the forum post in line with the request: title, tags, embed, buttons; locks it when finished.
export async function syncCraftPost(discordGuild: DiscordGuild | null, requestId: string): Promise<void> {
  if (!discordGuild) return;
  try {
    const request = await loadRequest(requestId);
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
  const [requestId, action] = rest.split(":");
  if (!requestId || !action) return;
  await interaction.deferReply({ ephemeral: true });
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

function requestModal(lang: Lang) {
  const T = (english: string) => tx(lang, english);
  const input = (id: string, label: string, placeholder: string, required: boolean, style = TextInputStyle.Short, max = 100) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(style).setRequired(required).setMaxLength(max));
  return new ModalBuilder().setCustomId(`${CRAFT_PREFIX}new-modal`).setTitle(T("Request a craft")).addComponents(
    input("item", T("Item"), T("Flask of the Titans"), true),
    input("profession", T("Profession"), T("Alchemy"), false, TextInputStyle.Short, 40),
    input("quantity", T("How many"), "1", false, TextInputStyle.Short, 3),
    input("note", T("Details (materials, deadline)"), T("I have the herbs"), false, TextInputStyle.Paragraph, 300)
  );
}

// The "Request a craft" form: creates the request and its post.
export async function handleCraftModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  try {
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
    const typed = interaction.fields.getTextInputValue("profession").trim();
    // Match the typed profession to a known one so the tag and crafter list work.
    // The typed name may be English or French; the stored value is always the English one.
    const spellings = (name: string) => [name.toLowerCase(), professionLabel("fr", name).toLowerCase()];
    const profession = PROFESSIONS.find((name) => spellings(name).includes(typed.toLowerCase())) ?? PROFESSIONS.find((name) => typed && spellings(name).some((spelling) => spelling.startsWith(typed.toLowerCase())));
    const quantity = Number(interaction.fields.getTextInputValue("quantity") || "1");
    const request = await craftService.request({
      guildId: guild.id, requesterId: member.id, item: interaction.fields.getTextInputValue("item"), profession,
      quantity: Number.isInteger(quantity) ? quantity : 1, note: interaction.fields.getTextInputValue("note") || undefined, materialsProvided: false
    });
    const posted = await postCraftRequest(interaction.guild, request.id);
    const lang = await boardLang(guild.id);
    await interaction.editReply({ content: posted.posted
      ? tx(lang, "Posted: <#{id}>. You'll get a DM when a crafter takes it.", { id: posted.threadId ?? "" })
      : tx(lang, "Request saved (ID `{id}`), but I couldn't post it to the board: check my permissions on the craft forum.", { id: request.id }) });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Could not create the request." });
  }
}
