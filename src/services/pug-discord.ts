import { cleanCharacterName } from "./character-display.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown, type Guild, type MessageCreateOptions } from "discord.js";
import type { DiscordJob, PrismaClient } from "../generated/prisma/client.js";
import { hostedPilot } from "../hosted-pilot.js";
import { mayShowPug, openCounts, PUG_ROLES, type PugCounts, type PugRole } from "./pug-requests.js";
import { serializeRaidPosts } from "./raid-signup-posts.js";

export const PUG_PREFIX = "pugb:";
type Lang = "en" | "fr";
const pt = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;

export const PUG_EDITION_LABEL: Record<string, string> = {
  forever: "WoW Forever", "classic-era": "Classic Era", "classic-tbc": "TBC Classic", "classic-mists": "Mists of Pandaria Classic", retail: "Retail"
};
const ROLE_ICON: Record<PugRole, string> = { TANK: "🛡️", HEALER: "💚", DPS: "⚔️" };
export const pugRoleLabel = (role: string, lang: Lang) => ({ TANK: pt(lang, "Tank", "Tank"), HEALER: pt(lang, "Healer", "Soigneur"), DPS: "DPS" } as Record<string, string>)[role] ?? role;

interface RequestView {
  id: string; raidTitle: string; scheduledAt: Date; expiresAt: Date; edition: string; note: string | null;
  wantTank: number; wantHealer: number; wantDps: number; closeReason?: string | null; guild: { name: string };
}

function localTime(date: Date, timezone: string, lang: Lang): string {
  try {
    return `${new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)} (${timezone})`;
  } catch { return date.toISOString(); }
}
const unix = (date: Date) => Math.floor(date.getTime() / 1000);
const spots = (open: PugCounts, want: PugCounts, lang: Lang) =>
  PUG_ROLES.filter(role => want[role] > 0).map(role => `${ROLE_ICON[role]} ${pugRoleLabel(role, lang)} **${open[role]}**/${want[role]}`).join("  ·  ") || "—";

/** The one message a guild's board shows. Always tagged as another guild's raid; no internal ids appear in it. */
export function pugPostPayload(request: RequestView, signups: { role: string; status: string }[], viewer: { lang: Lang; timezone: string }): Pick<MessageCreateOptions, "embeds" | "components" | "allowedMentions"> {
  const { lang } = viewer;
  const want: PugCounts = { TANK: request.wantTank, HEALER: request.wantHealer, DPS: request.wantDps };
  const open = openCounts(request, signups);
  const embed = new EmbedBuilder().setColor(0xe67e22)
    .setAuthor({ name: pt(lang, "🌐 OTHER GUILD'S RAID — not yours", "🌐 RAID D'UNE AUTRE GUILDE — pas la vôtre") })
    .setTitle(escapeMarkdown(request.raidTitle).slice(0, 200))
    .setDescription(pt(lang, `**${escapeMarkdown(request.guild.name)}** is looking for PUGs. Their officers approve every sign-up.`, `**${escapeMarkdown(request.guild.name)}** cherche des joueurs externes. Ses officiers approuvent chaque inscription.`))
    .addFields(
      { name: pt(lang, "When", "Quand"), value: `<t:${unix(request.scheduledAt)}:F> · <t:${unix(request.scheduledAt)}:R>\n${localTime(request.scheduledAt, viewer.timezone, lang)}` },
      { name: pt(lang, "Edition", "Édition"), value: PUG_EDITION_LABEL[request.edition] ?? request.edition, inline: true },
      { name: pt(lang, "Spots open", "Places ouvertes"), value: spots(open, want, lang), inline: true }
    )
    .setFooter({ text: pt(lang, "Removed automatically when the raid starts, fills or the request closes.", "Retiré automatiquement au début du raid, quand il est complet ou fermé.") });
  if (request.note) embed.addFields({ name: "Note", value: escapeMarkdown(request.note).slice(0, 200) });
  const buttons = PUG_ROLES.filter(role => open[role] > 0).map(role =>
    new ButtonBuilder().setCustomId(`${PUG_PREFIX}s:${request.id}:${role}`).setStyle(ButtonStyle.Success).setLabel(pt(lang, `Sign up: ${pugRoleLabel(role, lang)}`, `S'inscrire : ${pugRoleLabel(role, lang)}`)));
  buttons.push(new ButtonBuilder().setCustomId(`${PUG_PREFIX}blk:${request.id}`).setStyle(ButtonStyle.Secondary).setLabel(pt(lang, "Block this guild (officers)", "Bloquer cette guilde (officiers)")));
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)], allowedMentions: { parse: [] } };
}

export function pugClosedPayload(request: RequestView, lang: Lang): Pick<MessageCreateOptions, "embeds" | "components" | "allowedMentions"> {
  return { embeds: [new EmbedBuilder().setColor(0x7f8c8d).setTitle(`${pt(lang, "Closed", "Fermé")} — ${escapeMarkdown(request.raidTitle).slice(0, 200)}`)
    .setDescription(pt(lang, "This request is closed.", "Cette demande est fermée."))], components: [], allowedMentions: { parse: [] } };
}

const code = (error: unknown) => error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0;
const GONE = new Set([10003, 10008, 50001, 50013, 10004]);
const lacksMessage = (error: unknown) => code(error) === 10008;

/**
 * Delivers (creates, edits in place or removes) this guild's post. A deleted channel, a missing
 * permission or a message a moderator removed ends the post quietly instead of retrying forever.
 */
export async function deliverPugPost(guild: Guild, db: PrismaClient, job: DiscordJob, allows: (id: string) => boolean = hostedPilot.allows, now = new Date()): Promise<void> {
  const requestId = String((job.payload as Record<string, unknown>)["requestId"] ?? "");
  const where = { requestId_guildId: { requestId, guildId: job.guildId } };
  await serializeRaidPosts(`pugpost:${requestId}:${job.guildId}`, async () => {
    const post = await db.pugPost.findUnique({ where, include: { request: { include: { guild: { select: { name: true } }, signups: { select: { role: true, status: true } } } } } });
    if (!post || post.removedAt) return;
    const retire = () => db.pugPost.update({ where, data: { removedAt: now } });
    const settings = await db.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { timezone: true, language: true } });
    const lang: Lang = settings?.language === "fr" ? "fr" : "en";
    const request = post.request;
    const show = request.status === "OPEN" && request.expiresAt > now && request.scheduledAt > now && await mayShowPug(db, request, job.guildId, allows);
    const channel = await guild.channels.fetch(post.channelId).catch((error: unknown) => { if (GONE.has(code(error))) return null; throw error; });
    if (!channel?.isTextBased() || !("send" in channel)) { await retire(); return; }
    const message = post.messageId ? await channel.messages.fetch(post.messageId).catch((error: unknown) => { if (lacksMessage(error)) return null; throw error; }) : null;
    try {
      if (!show) {
        if (message) {
          // Closed first, so a delete that fails leaves a harmless note rather than a live sign-up button.
          await message.edit(pugClosedPayload(request, lang)).catch((error: unknown) => { if (!GONE.has(code(error))) throw error; });
          await message.delete().catch((error: unknown) => { if (!GONE.has(code(error))) throw error; });
        }
        await retire();
        return;
      }
      const payload = pugPostPayload(request, request.signups, { lang, timezone: settings?.timezone ?? "America/Toronto" });
      if (message) await message.edit(payload);
      // A message a moderator deleted stays deleted: do not re-post on every refresh.
      else if (post.messageId) await retire();
      else {
        const sent = await channel.send({ ...payload, nonce: post.id.slice(-25), enforceNonce: true });
        await db.pugPost.update({ where, data: { messageId: sent.id } });
      }
    } catch (error) {
      if (GONE.has(code(error))) { await retire(); return; }
      throw error;
    }
  });
}

/** The single, aggregated message in the requesting guild's raid channel: waiting PUGs, accepted guests, buttons. */
export function pugNoticePayload(request: RequestView & { status: string }, signups: { id: string; displayName: string; sourceGuild: string | null; characterName: string; characterClass: string | null; role: string; note: string | null; status: string }[], lang: Lang): Pick<MessageCreateOptions, "embeds" | "components" | "allowedMentions"> {
  const line = (s: (typeof signups)[number]) => `${ROLE_ICON[s.role as PugRole] ?? ""} **${escapeMarkdown(cleanCharacterName(s.characterName))}**${s.characterClass ? ` (${s.characterClass})` : ""} — ${escapeMarkdown(s.displayName)}${s.sourceGuild ? ` · ${escapeMarkdown(s.sourceGuild)}` : ""}${s.note ? `\n> ${escapeMarkdown(s.note)}` : ""}`;
  const pending = signups.filter(s => s.status === "PENDING");
  const accepted = signups.filter(s => s.status === "ACCEPTED");
  const open = openCounts(request, signups);
  const want: PugCounts = { TANK: request.wantTank, HEALER: request.wantHealer, DPS: request.wantDps };
  const embed = new EmbedBuilder().setColor(request.status === "OPEN" ? 0x3498db : 0x7f8c8d)
    .setTitle(`${pt(lang, "Guest PUGs", "Joueurs externes")} — ${escapeMarkdown(request.raidTitle).slice(0, 180)}`)
    .setDescription(`${request.status === "OPEN" ? pt(lang, "Open", "Ouvert") : pt(lang, "Closed", "Fermé")} · ${spots(open, want, lang)}`)
    .addFields(
      { name: pt(lang, `Waiting (${pending.length})`, `En attente (${pending.length})`), value: pending.slice(0, 8).map(line).join("\n").slice(0, 1000) || "—" },
      { name: pt(lang, `Accepted guests (${accepted.length})`, `Invités acceptés (${accepted.length})`), value: accepted.map(line).join("\n").slice(0, 1000) || "—" }
    )
    .setFooter({ text: pt(lang, "Guests are not on your roster or server automatically: invite accepted players in game.", "Les invités ne rejoignent ni votre liste ni votre serveur automatiquement : invitez-les en jeu.") });
  const buttons: ButtonBuilder[] = [];
  if (request.status === "OPEN") {
    if (pending.length) buttons.push(new ButtonBuilder().setCustomId(`${PUG_PREFIX}rv:${request.id}`).setStyle(ButtonStyle.Primary).setLabel(pt(lang, "Review guests", "Examiner")));
    buttons.push(new ButtonBuilder().setCustomId(`${PUG_PREFIX}cl:${request.id}`).setStyle(ButtonStyle.Danger).setLabel(pt(lang, "Close request", "Fermer la demande")));
  }
  return { embeds: [embed], components: buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [], allowedMentions: { parse: [] } };
}

export async function deliverPugNotice(guild: Guild, db: PrismaClient, job: DiscordJob): Promise<void> {
  const requestId = String((job.payload as Record<string, unknown>)["requestId"] ?? "");
  await serializeRaidPosts(`pugnotice:${requestId}`, async () => {
    const request = await db.pugRequest.findFirst({ where: { id: requestId, guildId: job.guildId }, include: { guild: { select: { name: true } }, signups: { orderBy: { createdAt: "asc" } } } });
    if (!request) return;
    const raid = await db.raid.findUnique({ where: { id: request.raidId }, select: { signupChannelId: true } });
    const channelId = request.noticeChannelId ?? raid?.signupChannelId;
    if (!channelId || (!request.signups.length && !request.noticeMessageId)) return;
    const settings = await db.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { language: true } });
    const payload = pugNoticePayload(request, request.signups, settings?.language === "fr" ? "fr" : "en");
    const channel = await guild.channels.fetch(channelId).catch((error: unknown) => { if (GONE.has(code(error))) return null; throw error; });
    if (!channel?.isTextBased() || !("send" in channel)) return;
    const existing = request.noticeMessageId ? await channel.messages.fetch(request.noticeMessageId).catch((error: unknown) => { if (lacksMessage(error)) return null; throw error; }) : null;
    try {
      if (existing) { await existing.edit(payload); return; }
      const sent = await channel.send({ ...payload, nonce: request.id.slice(-25), enforceNonce: true });
      await db.pugRequest.update({ where: { id: request.id }, data: { noticeChannelId: channelId, noticeMessageId: sent.id } });
    } catch (error) {
      if (GONE.has(code(error))) return; // The channel cannot be written to: officers still have /raid pugs status.
      throw error;
    }
  });
}
