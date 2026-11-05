import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  type ButtonInteraction, type Client, type Guild as DiscordGuild, type GuildMember
} from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { tx, type Lang } from "../i18n.js";
import { createCraftService } from "../services/craft.js";
import { createCraftOfferService } from "../services/craft-offers.js";
import { updateProfessionDirectory } from "../services/profession-directory.js";
import { boardForum, boardLang, ensureBoardTags, postCraftRequest, professionLabel, tagIds } from "./craft-board.js";
import { guildService } from "./context.js";

// Crafter offers on the craft board. An offer is its own forum post (same forum, same status and
// profession tags as requests). "I'd like this" creates an ordinary craft request, so claiming,
// status and completion work as before. Posts never mention roles or @everyone, and Guilded never
// handles gold: the price is free text and the trade happens in game.

export const OFFER_PREFIX = "craft:offer:";
export const offerService = createCraftOfferService(prisma);
const craftService = createCraftService(prisma);

type OfferRow = Awaited<ReturnType<typeof offerService.find>>;

export function offerTitle(offer: Pick<OfferRow, "status" | "item">): string {
  return `${offer.status === "ACTIVE" ? "💰 Offer:" : "⛔ Offer ended:"} ${offer.item}`.slice(0, 100);
}

export function offerEmbed(offer: OfferRow, lang: Lang = "en"): EmbedBuilder {
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const ended = offer.status !== "ACTIVE";
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x808080 : 0xd4af37)
    .setTitle(`💰 ${offer.item}`.slice(0, 250))
    .addFields(
      { name: T("Crafter"), value: `<@${offer.crafter.discordUserId}>`, inline: true },
      { name: T("Price"), value: offer.price ?? T("Ask the crafter"), inline: true },
      { name: T("Materials"), value: offer.materialsProvided ? T("Buyer brings them") : T("Crafter's or to be arranged"), inline: true },
      { name: T("Recipe"), value: offer.verified ? T("✅ Recorded for {character}", { character: offer.character ?? offer.crafter.displayName }) : T("⚠️ Unverified: typed by the crafter, no recorded recipe"), inline: false },
      { name: ended ? T("Status") : T("Offer ends"), value: ended ? (offer.status === "WITHDRAWN" ? T("Withdrawn") : T("Expired")) : `<t:${Math.floor(offer.expiresAt.getTime() / 1000)}:R>`, inline: true }
    )
    .setFooter({ text: T("Offer {id} · Trade in game: Guilded never handles gold", { id: offer.id }) });
  if (offer.profession) embed.addFields({ name: T("Profession"), value: professionLabel(lang, offer.profession), inline: true });
  if (offer.note) embed.setDescription(offer.note.slice(0, 1000));
  return embed;
}

function offerButtons(offer: Pick<OfferRow, "id" | "status">, lang: Lang) {
  if (offer.status !== "ACTIVE") return [];
  const b = (action: string, label: string, style: ButtonStyle) => new ButtonBuilder().setCustomId(`${OFFER_PREFIX}${offer.id}:${action}`).setLabel(label).setStyle(style);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(b("buy", tx(lang, "I'd like this"), ButtonStyle.Success), b("withdraw", tx(lang, "Withdraw offer"), ButtonStyle.Danger))];
}

// Creates the forum post of a new offer. False when the craft channel is not a forum.
export async function postCraftOffer(discordGuild: DiscordGuild | null, offerId: string): Promise<{ posted: boolean; threadId?: string }> {
  if (!discordGuild) return { posted: false };
  try {
    const offer = await prisma.craftOffer.findUniqueOrThrow({ where: { id: offerId }, include: { crafter: true } });
    const forum = await boardForum(discordGuild, offer.guildId);
    if (!forum) return { posted: false };
    const lang = await boardLang(offer.guildId);
    await ensureBoardTags(forum, lang);
    const thread = await forum.threads.create({
      name: offerTitle(offer),
      message: { embeds: [offerEmbed(offer, lang)], components: offerButtons(offer, lang), allowedMentions: { parse: [] } },
      appliedTags: tagIds(forum, "OPEN", offer.profession)
    });
    await prisma.craftOffer.update({ where: { id: offer.id }, data: { threadId: thread.id } });
    return { posted: true, threadId: thread.id };
  } catch (error) {
    console.error("Failed to post the craft offer to the board", error);
    return { posted: false };
  }
}

// Brings an offer's post in line with its status; an ended offer locks its post.
export async function syncCraftOffer(discordGuild: DiscordGuild | null, offerId: string): Promise<void> {
  if (!discordGuild) return;
  try {
    const offer = await prisma.craftOffer.findUniqueOrThrow({ where: { id: offerId }, include: { crafter: true } });
    if (!offer.threadId) return;
    const forum = await boardForum(discordGuild, offer.guildId);
    const thread = await forum?.threads.fetch(offer.threadId).catch(() => null);
    if (!forum || !thread) return;
    if (thread.archived) await thread.setArchived(false).catch(() => undefined);
    if (thread.locked) await thread.setLocked(false).catch(() => undefined);
    const lang = await boardLang(offer.guildId);
    const starter = await thread.fetchStarterMessage().catch(() => null);
    await starter?.edit({ embeds: [offerEmbed(offer, lang)], components: offerButtons(offer, lang), allowedMentions: { parse: [] } });
    await thread.setName(offerTitle(offer)).catch(() => undefined);
    if (offer.status !== "ACTIVE") {
      await thread.setAppliedTags(tagIds(forum, "CANCELLED", offer.profession)).catch(() => undefined);
      await thread.send({ content: tx(lang, "⛔ This offer has ended. Closing this post."), allowedMentions: { parse: [] } }).catch(() => undefined);
      await thread.setLocked(true).catch(() => undefined);
      await thread.setArchived(true).catch(() => undefined);
    }
  } catch (error) {
    console.error("Failed to update the craft offer post", error);
  }
}

// Hourly job: closes offers past their time (post locked, directory refreshed).
export async function sweepCraftOffers(client: Client, now = new Date()): Promise<number> {
  const expired = await offerService.expireDue(now);
  const refreshed = new Set<string>();
  for (const offer of expired) {
    const discordGuild = client.guilds.cache.get(offer.guild.discordId) ?? null;
    await syncCraftOffer(discordGuild, offer.id);
    if (discordGuild && !refreshed.has(offer.guildId)) { refreshed.add(offer.guildId); await updateProfessionDirectory(discordGuild).catch(() => undefined); }
  }
  return expired.length;
}

export async function handleOfferButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const [offerId, action] = interaction.customId.slice(OFFER_PREFIX.length).split(":");
  if (!offerId || !action) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = await boardLang(guild.id);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  const isOfficer = !!interaction.member && hasPermission(interaction.member as GuildMember, "officer");
  const dm = (userId: string, text: string) => interaction.client.users.send(userId, text).catch(() => undefined);
  try {
    if (!(await offerService.isEnabled(guild.id))) throw new Error(T("Crafter offers are off on this server."));
    if (action === "buy") {
      const offer = await offerService.answerable(guild.id, offerId, member.id);
      const request = await craftService.request({
        guildId: guild.id, requesterId: member.id, item: offer.item, profession: offer.profession ?? undefined, quantity: 1,
        note: T("Answering {crafter}'s offer.{price}", { crafter: offer.crafter.displayName, price: offer.price ? ` ${offer.price}.` : "" }),
        materialsProvided: offer.materialsProvided, offerId: offer.id
      });
      const posted = await postCraftRequest(interaction.guild, request.id);
      await interaction.editReply({ content: posted.posted
        ? T("Request posted: <#{id}>. {crafter} gets a message.", { id: posted.threadId ?? "", crafter: offer.crafter.displayName })
        : T("Request saved (ID `{id}`). Trade in game.", { id: request.id }) });
      await dm(offer.crafter.discordUserId, T("💰 {name} would like your offer of {item}. Claim the request {where} to take it.", {
        name: member.displayName, item: `**${offer.item}**`, where: posted.threadId ? `<#${posted.threadId}>` : `(/craft list, \`${request.id}\`)`
      }));
    } else if (action === "withdraw") {
      await offerService.withdraw(guild.id, offerId, member.id, isOfficer);
      await interaction.editReply({ content: T("Offer withdrawn.") });
      await syncCraftOffer(interaction.guild, offerId);
      await updateProfessionDirectory(interaction.guild).catch(() => undefined);
    }
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : T("That didn't work.") });
  }
}
