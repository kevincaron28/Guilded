import { AttachmentBuilder, EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient, RaidRole } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { canonicalClass } from "./character-display.js";
import { OPEN_GROUP_HOURS } from "./dungeon-group.js";
import { classColor, scoreCardPng, type ScoreCard } from "./score-card.js";

// The PvP group finder's post (9.1 redesign): one picture (the shared card layout: party with role icons, size, bracket, expiry)
// plus an embed with the roster by role, the queue in order and who leads. The buttons are the dungeon finder's (`dgrp:`).

export const PVP_CARD_FILE = "pvp-group.png";
const ROLE_ICON: Record<RaidRole, string> = { TANK: "🛡️", HEALER: "💚", DPS: "⚔️" };

export interface PvpPostPlayer { name: string; role: RaidRole; color?: string | undefined }
export interface PvpPostData {
  id: string; title: string; size: number; status: "OPEN" | "STARTED" | "CLOSED"; createdAt: Date; minLevel: number | null; maxLevel: number | null;
  leaderDiscordId: string; voiceChannelId: string | null; members: PvpPostPlayer[]; waiting: PvpPostPlayer[];
}

/** Pure: the level bracket. A range inside one WoW battleground bracket (10-19, 20-29 ...) reads "Bracket 20-29"; anything else lists the levels. */
export function pvpBracket(min: number | null, max: number | null, lang: Lang): string {
  const fr = lang === "fr";
  if (min === null && max === null) return fr ? "Tous niveaux" : "Any level";
  const low = min ?? 1, high = max ?? 80;
  const decade = Math.floor(low / 10) * 10;
  if (low === high) return fr ? `Niveau ${low}` : `Level ${low}`;
  if (low >= 10 && high < 80 && Math.floor(high / 10) * 10 === decade) return fr ? `Tranche ${decade}-${decade + 9}` : `Bracket ${decade}-${decade + 9}`;
  return high >= 80 ? (fr ? `Niveaux ${low}+` : `Levels ${low}+`) : (fr ? `Niveaux ${low}-${high}` : `Levels ${low}-${high}`);
}

/** Pure: when an open group stops accepting people (24 hours after it was posted). */
export const pvpExpiresAt = (createdAt: Date) => new Date(createdAt.getTime() + OPEN_GROUP_HOURS * 3_600_000);

const statusText = (status: PvpPostData["status"], fr: boolean) => status === "OPEN" ? (fr ? "Ouvert" : "Open") : status === "STARTED" ? (fr ? "Démarré" : "Started") : (fr ? "Fermé" : "Closed");
const roleName = (role: RaidRole, fr: boolean) => role === "TANK" ? "Tank" : role === "HEALER" ? (fr ? "Soigneur" : "Healer") : "DPS";

/** Pure: the picture. */
export function pvpGroupCard(data: PvpPostData, lang: Lang): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const seed = [...data.id].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) | 0, 7);
  return {
    eyebrow: t("Guilded · PvP group", "Guilded · Groupe JcJ"),
    title: data.title,
    subtitle: `${pvpBracket(data.minLevel, data.maxLevel, lang)} · ${statusText(data.status, fr)}`,
    stats: [
      { label: t("Players", "Joueurs"), value: `${data.members.length}/${data.size}`, accent: data.members.length >= data.size ? "green" : "gold",
        note: data.waiting.length ? t(`${data.waiting.length} in the queue`, `${data.waiting.length} en attente`) : undefined },
      { label: t("Roles", "Rôles"), value: (["TANK", "HEALER", "DPS"] as const).map(role => `${role === "TANK" ? "T" : role === "HEALER" ? "H" : "D"}${data.members.filter(m => m.role === role).length}`).join("  "),
        note: t("Tank / Healer / DPS", "Tank / Soigneur / DPS") },
      { label: t("Open until", "Ouvert jusqu'à"), value: pvpExpiresAt(data.createdAt).toISOString().slice(11, 16) + " UTC", note: t("24 h after posting", "24 h après la publication") }
    ],
    rowsLabel: t(`In the group · ${data.members.length}/${data.size}`, `Dans le groupe · ${data.members.length}/${data.size}`),
    footer: t("Guilded · Press a role button on the post to join · guilded.kcaron.top", "Guilded · Appuyez sur un rôle sur le message pour rejoindre · guilded.kcaron.top"),
    dungeon: {
      theme: { a: "#7f1d1d", b: "#d4a017", motif: "fire", seed },
      party: data.members.slice(0, 40).map(player => ({ name: player.name, color: player.color ?? "#cbd5e1", role: player.role, roleLabel: roleName(player.role, fr), guild: true })),
      guildLabel: t("Guild", "Guilde"), outsiderLabel: t("Outside guild", "Hors guilde"), moreLabel: t("more", "autres")
    }
  };
}

/** Pure: the embed under the picture. */
export function pvpGroupEmbed(data: PvpPostData, lang: Lang, image?: string): EmbedBuilder {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 40);
  const expires = Math.floor(pvpExpiresAt(data.createdAt).getTime() / 1000);
  const byRole = (role: RaidRole) => data.members.filter(m => m.role === role).map(m => name(m.name));
  const embed = new EmbedBuilder().setColor(data.status === "CLOSED" ? 0x808080 : 0xb91c1c)
    .setTitle(`⚔️ ${data.title}`.slice(0, 256))
    .setDescription([`**${pvpBracket(data.minLevel, data.maxLevel, lang)}** · ${data.members.length}/${data.size} · ${statusText(data.status, fr)}`,
      data.status === "OPEN" ? t(`Closes <t:${expires}:R> if it is not started.`, `Se ferme <t:${expires}:R> s'il n'est pas démarré.`) : ""].filter(Boolean).join("\n"));
  for (const role of ["TANK", "HEALER", "DPS"] as const) {
    const names = byRole(role);
    embed.addFields({ name: `${ROLE_ICON[role]} ${roleName(role, fr)} (${names.length})`, value: names.length ? names.join(", ").slice(0, 1000) : "—", inline: true });
  }
  embed.addFields({ name: t("Leader", "Responsable"), value: `<@${data.leaderDiscordId}>`, inline: true });
  if (data.waiting.length) embed.addFields({ name: t(`Queue (${data.waiting.length})`, `File d'attente (${data.waiting.length})`),
    value: data.waiting.slice(0, 15).map((p, i) => `${i + 1}. ${name(p.name)} ${ROLE_ICON[p.role]}`).join("\n").slice(0, 1000) + (data.waiting.length > 15 ? "\n…" : "") });
  if (data.voiceChannelId) embed.addFields({ name: t("Voice", "Vocal"), value: t(`<#${data.voiceChannelId}> (private to the group; deleted when empty)`, `<#${data.voiceChannelId}> (privé pour le groupe ; supprimé quand il est vide)`) });
  if (image) embed.setImage(`attachment://${image}`);
  return embed.setFooter({ text: t(`Group ${data.id} · the first in line is promoted when a place opens`, `Groupe ${data.id} · le premier en file passe quand une place se libère`) });
}

/** Loads a PvP group from the database for the post. Class colours come from each member's main character, when linked. */
export async function loadPvpPostData(db: Pick<PrismaClient, "dungeonGroup" | "dungeonGroupSignup" | "member" | "character">, groupId: string): Promise<PvpPostData> {
  const group = await db.dungeonGroup.findUniqueOrThrow({ where: { id: groupId } });
  const signups = await db.dungeonGroupSignup.findMany({ where: { groupId }, include: { member: true }, orderBy: { joinedAt: "asc" } });
  const leader = await db.member.findUnique({ where: { id: group.leaderId }, select: { discordUserId: true } });
  const characters = await db.character.findMany({ where: { memberId: { in: signups.map(s => s.memberId) } }, orderBy: [{ isMain: "desc" }, { level: "desc" }], select: { memberId: true, className: true } });
  const color = new Map<string, string>();
  for (const character of characters) if (!color.has(character.memberId)) color.set(character.memberId, classColor(canonicalClass(character.className) ?? character.className));
  const player = (s: (typeof signups)[number]): PvpPostPlayer => ({ name: s.member.displayName, role: s.role, color: color.get(s.memberId) });
  return { id: group.id, title: group.title, size: group.maxSize, status: group.status as PvpPostData["status"], createdAt: group.createdAt, minLevel: group.minLevel, maxLevel: group.maxLevel,
    leaderDiscordId: leader?.discordUserId ?? "0", voiceChannelId: group.voiceChannelId, members: signups.filter(s => s.status === "SIGNED_UP").map(player), waiting: signups.filter(s => s.status === "WAITLISTED").map(player) };
}

/** The message body for a PvP group: picture + embed (the picture is skipped when it cannot be drawn). */
export async function pvpPostPayload(db: Parameters<typeof loadPvpPostData>[0], groupId: string, lang: Lang): Promise<{ embeds: EmbedBuilder[]; files: AttachmentBuilder[] }> {
  const data = await loadPvpPostData(db, groupId);
  const png = await scoreCardPng(pvpGroupCard(data, lang)).catch(() => null);
  return { embeds: [pvpGroupEmbed(data, lang, png ? PVP_CARD_FILE : undefined)], files: png ? [new AttachmentBuilder(png, { name: PVP_CARD_FILE })] : [] };
}
