import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, escapeMarkdown, type Guild, type ModalSubmitInteraction } from "discord.js";
import type { CommunityKudos, CommunitySeason, PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { COMMUNITY_HUB_PREFIX } from "./community-panels.js";
import { communitySeasonLabel } from "./community-display.js";
import { createParticipationService } from "./participation.js";
import { eligibleParticipationMember } from "./participation-discord.js";
import { participationRules } from "./participation-rules.js";

// Helper nominations wait for a Discord officer other than the two members involved. Each one
// gets a review card in the Discord admin channel (the community officers' channel, not the WoW
// officers' log) with Approve / Reject buttons; /participation claims and review still work.

const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const POSTING = "posting";

export function nominationCard(lang: Lang, claim: CommunityKudos, season: CommunitySeason) {
  const decided = claim.status !== "PENDING";
  const icon = claim.status === "APPROVED" ? "✅" : decided ? "❌" : "🙌";
  const embed = new EmbedBuilder().setColor(claim.status === "APPROVED" ? 0x2ecc71 : decided ? 0xe74c3c : 0xf1c40f)
    .setTitle(`${icon} ${say(lang, "Helper nomination", "Nomination d’entraide")}`)
    .setDescription(escapeMarkdown(claim.reason.slice(0, 300)))
    .addFields(
      { name: say(lang, "Helper", "Aidant"), value: `<@${claim.userId}>`, inline: true },
      { name: say(lang, "Nominated by", "Nommé par"), value: `<@${claim.nominatorId}>`, inline: true },
      { name: say(lang, "Season", "Saison"), value: escapeMarkdown(communitySeasonLabel(season, lang)), inline: true }
    )
    .setFooter({ text: decided
      ? say(lang, `Reviewed · ID ${claim.id}`, `Validée · ID ${claim.id}`)
      : say(lang, `Discord community review · needs an officer who is not involved · ID ${claim.id}`, `Validation de la communauté Discord · un officier non impliqué est requis · ID ${claim.id}`) });
  if (decided) embed.addFields({ name: claim.status === "APPROVED" ? say(lang, "Approved by", "Approuvée par") : say(lang, "Rejected by", "Refusée par"),
    value: `${claim.reviewedBy ? `<@${claim.reviewedBy}>` : "—"}${claim.reviewNote ? `\n${escapeMarkdown(claim.reviewNote.slice(0, 300))}` : ""}` });
  const button = (action: "approve" | "reject", label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(`${COMMUNITY_HUB_PREFIX}nomreview:${claim.id}:${action}`).setLabel(label).setStyle(style);
  return {
    embeds: [embed],
    components: decided ? [] : [new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("approve", say(lang, "Approve", "Approuver"), ButtonStyle.Success), button("reject", say(lang, "Reject", "Refuser"), ButtonStyle.Danger))],
    allowedMentions: { parse: [] as [] }
  };
}

// Posts a card for every pending nomination that has none yet (new ones, and ones made before the
// admin channel existed). Never throws for a missing or unusable channel: the slash commands remain.
export async function postNominationCards(guild: Guild, database: PrismaClient, guildId: string): Promise<number> {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { adminChannelId: true, language: true } });
  if (!settings?.adminChannelId) return 0;
  const channel = guild.channels.cache.get(settings.adminChannelId) ?? await guild.channels.fetch(settings.adminChannelId).catch(() => null);
  const me = guild.members.me;
  if (!channel || channel.type !== ChannelType.GuildText || !me || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return 0;
  const lang = asLang(settings.language);
  const pending = await database.communityKudos.findMany({ where: { status: "PENDING", cardMessageId: null, season: { guildId, game: "DISCORD", status: "ACTIVE" } },
    include: { season: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 });
  let posted = 0;
  for (const { season, ...claim } of pending) {
    // Claim the row first so the immediate post and the periodic check never send two cards.
    if ((await database.communityKudos.updateMany({ where: { id: claim.id, cardMessageId: null }, data: { cardMessageId: POSTING } })).count !== 1) continue;
    try {
      const message = await channel.send(nominationCard(lang, claim, season));
      await database.communityKudos.update({ where: { id: claim.id }, data: { cardMessageId: message.id } });
      posted++;
    } catch (error) {
      await database.communityKudos.updateMany({ where: { id: claim.id, cardMessageId: POSTING }, data: { cardMessageId: null } });
      throw error;
    }
  }
  return posted;
}

// The shared approve/reject path for /participation review and the card buttons.
export async function reviewNomination(guild: Guild, database: PrismaClient, guildId: string, id: string, actorId: string, approve: boolean, note: string, seasonId?: string) {
  const claim = await database.communityKudos.findFirst({ where: { id, ...(seasonId ? { seasonId } : {}), season: { guildId, game: "DISCORD" } }, include: { season: { include: { participation: true } } } });
  if (!claim) throw new Error("Nomination introuvable / Nomination not found.");
  if (approve) {
    const rules = participationRules.parse(claim.season.participation?.rules ?? {});
    for (const userId of [claim.userId, claim.nominatorId]) {
      const person = await guild.members.fetch({ user: userId, force: true });
      if (!eligibleParticipationMember(person, claim.season, rules, new Date())) throw new Error("Membres admissibles requis / Eligible members required.");
    }
  }
  const reviewed = await createParticipationService(database).review(guildId, claim.seasonId, id, actorId, approve, note);
  return { reviewed, season: claim.season };
}

// The reason form opened by a card button. The card is edited in place; a refusal (not an
// officer, one of the two members involved, earning paused) is shown only to the person who clicked.
export async function decideNominationFromCard(interaction: ModalSubmitInteraction, database: PrismaClient, guildId: string, claimId: string, approve: boolean): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.isFromMessage()) throw new Error("Bouton invalide / Invalid button.");
  if (!interaction.deferred) await interaction.deferUpdate();
  try {
    const member = await guild.members.fetch(interaction.user.id);
    if (!hasPermission(member, "officer")) throw new Error("Officiers seulement / Officers only.");
    const lang = asLang((await database.guildSettings.findUnique({ where: { guildId }, select: { language: true } }))?.language);
    const { reviewed, season } = await reviewNomination(guild, database, guildId, claimId, interaction.user.id, approve, interaction.fields.getTextInputValue("reason"));
    await interaction.editReply(nominationCard(lang, reviewed, season));
  } catch (error) {
    const content = error instanceof Error && error.message.length < 250 ? error.message : "Impossible de traiter cette demande / Could not process this request.";
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}
