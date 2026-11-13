import { cardAttachment } from "./card-alt.js";
import { EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { isOwnBoard } from "./board-identity.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { PROFESSION_FR } from "./profession-style.js";
import { classColor, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";
import { moveColumn, moveFields, trackRanks, type Movements } from "./ladder-snapshots.js";
import { guildWhere } from "./guild-scope.js";

// 9.1 (owner, 7 November 2026): "craft history and a point system, so we see the top crafters".
//   * History: one CraftCompletion row per finished craft, written when a board request is marked
//     done (once per request; the migration backfills earlier ones). In-game orders, when they
//     exist, add rows with source "game" through recordCraftCompletion.
//   * Points: one per finished craft. Item rarity and recipe skill are not stored anywhere yet, so
//     there is no weighting; `points` is kept per row so a later weighting never rewrites history.
//   * The "Top crafters" card (shared ladder layout, docs/LEADERBOARD_CARDS.md) in #top-crafters,
//     edited in place after each finished craft. On by default; officer off switch
//     /craft notify-setting ladder:False. Nothing here awards EP/GP or community points.

export const LADDER_TOP = 25;
export const CRAFT_LADDER_MARKER = "Guilded craft ladder";
export const CRAFT_CARD_FILE = "top-crafters.png";
const MONTH_MS = 30 * 86_400_000;

export interface CrafterStanding { memberId: string; name: string; className: string | null; points: number; crafts: number; month: number; topProfession: string | null; lastAt: Date }

type HistoryDb = Pick<PrismaClient, "craftCompletion">;

/** Writes the history row for a finished board request (once: the request id is unique). */
export async function recordCraftCompletion(db: HistoryDb, row: { guildId: string; crafterId: string; item: string; quantity: number; profession: string | null; requestId?: string | null; source?: "board" | "game"; doneAt?: Date }): Promise<boolean> {
  const data = { guildId: row.guildId, crafterId: row.crafterId, item: row.item.slice(0, 100), quantity: row.quantity, profession: row.profession,
    source: row.source ?? "board", requestId: row.requestId ?? null, points: 1, doneAt: row.doneAt ?? new Date() };
  if (!data.requestId) { await db.craftCompletion.create({ data }); return true; }
  const done = await db.craftCompletion.upsert({ where: { requestId: data.requestId }, create: data, update: {} }).catch(() => null);
  return !!done;
}

/** Pure: standings from history rows, by points, then crafts this month, then the most recent craft. */
export function crafterStandings(rows: readonly { crafterId: string; points: number; profession: string | null; doneAt: Date }[],
  names: ReadonlyMap<string, { name: string; className: string | null }>, now = new Date()): CrafterStanding[] {
  const by = new Map<string, CrafterStanding & { professions: Map<string, number> }>();
  for (const row of rows) {
    const who = names.get(row.crafterId);
    if (!who) continue;
    const entry = by.get(row.crafterId) ?? { memberId: row.crafterId, name: who.name, className: who.className, points: 0, crafts: 0, month: 0, topProfession: null, lastAt: row.doneAt, professions: new Map() };
    entry.points += row.points;
    entry.crafts += 1;
    if (now.getTime() - row.doneAt.getTime() <= MONTH_MS) entry.month += 1;
    if (row.doneAt > entry.lastAt) entry.lastAt = row.doneAt;
    if (row.profession) entry.professions.set(row.profession, (entry.professions.get(row.profession) ?? 0) + 1);
    by.set(row.crafterId, entry);
  }
  return [...by.values()].map(({ professions, ...entry }) => ({ ...entry, topProfession: [...professions.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null }))
    .sort((a, b) => b.points - a.points || b.month - a.month || b.lastAt.getTime() - a.lastAt.getTime() || a.name.localeCompare(b.name));
}

const professionName = (lang: Lang, profession: string | null) => !profession ? "—" : lang === "fr" ? PROFESSION_FR[profession] ?? profession : profession;

/** Pure: the ladder card. */
export function craftLadderCard(standings: readonly CrafterStanding[], totalCrafts: number, lang: Lang, updatedAt = new Date(), moves: Movements | null = null): ScoreCard {
  const fr = lang === "fr";
  return {
    eyebrow: `Guilded · ${fr ? "Artisanat" : "Crafting"}`, title: fr ? "Meilleurs artisans" : "Top crafters",
    subtitle: fr ? `${totalCrafts} commandes terminées · ${standings.length} artisans` : `${totalCrafts} finished crafts · ${standings.length} crafters`,
    backdrop: { kind: "board", key: "crafters" },
    stats: [], footer: fr ? "1 point par commande terminée sur le tableau d'artisanat · aucun EP/GP" : "1 point per craft finished on the craft board · no EP/GP",
    ladder: {
      meta: ladderMeta(lang, updatedAt), empty: fr ? "Aucune commande terminée pour l'instant." : "No finished crafts yet.",
      columns: [{ label: fr ? "Points" : "Points", width: 64, primary: true }, { label: fr ? "30 j" : "30d", width: 48 }, { label: fr ? "Métier" : "Profession", width: 130 }, ...(moves ? [moveColumn(lang)] : [])],
      boards: [{ rows: standings.slice(0, LADDER_TOP).map((row, index) => ({ rank: index + 1, name: row.name, color: classColor(row.className),
        values: [String(row.points), String(row.month), professionName(lang, row.topProfession), ""], ...moveFields(moves, row.memberId, lang) })) }]
    }
  };
}

/** Pure: the embed under the card (the top 3, or the whole top 10 when no card could be drawn). */
export function craftLadderEmbed(standings: readonly CrafterStanding[], lang: Lang, guildId: string, image?: string): EmbedBuilder {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const embed = new EmbedBuilder().setColor(0xc9a227).setTitle(t("🔨 Top crafters", "🔨 Meilleurs artisans"));
  // With the picture the top 3 repeat the card, so the embed keeps only its title (9.3).
  if (!(image && standings.length)) embed.setDescription(standings.length ? standings.slice(0, 10).map((row, index) =>
    `${["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`} ${escapeMarkdown(row.name).slice(0, 40)} — ${row.points} ${t("pt", "pt")} · ${row.month} ${t("in 30 days", "en 30 jours")}`).join("\n")
    : t("No finished crafts yet. Ask on the craft board!", "Aucune commande terminée. Demandez sur le tableau d'artisanat!"));
  if (image && standings.length) embed.setImage(`attachment://${image}`);
  return embed.setFooter({ text: t("1 point per finished order on the crafting board · no EP/GP", "1 point par commande terminée sur le tableau d'artisanat · aucun EP/GP") });
}

type LoadDb = HistoryDb & Pick<PrismaClient, "member" | "character">;

export async function loadCrafterStandings(db: LoadDb, guildId: string, now = new Date()): Promise<{ standings: CrafterStanding[]; total: number }> {
  const rows = await db.craftCompletion.findMany({ where: { guildId }, select: { crafterId: true, points: true, profession: true, doneAt: true } });
  const ids = [...new Set(rows.map((r) => r.crafterId))];
  const [members, mains] = await Promise.all([
    db.member.findMany({ where: { id: { in: ids }, status: "ACTIVE", isTest: false }, select: { id: true, displayName: true } }),
    db.character.findMany({ where: { memberId: { in: ids } }, select: { memberId: true, name: true, className: true, isMain: true } })
  ]);
  const names = new Map(members.map((m) => {
    const characters = mains.filter((c) => c.memberId === m.id);
    const main = characters.find((c) => c.isMain) ?? characters[0];
    return [m.id, { name: main?.name ?? m.displayName, className: main?.className ?? null }];
  }));
  return { standings: crafterStandings(rows, names, now), total: rows.length };
}

/** The member's history lines for /craft history. */
export async function craftHistoryLines(db: HistoryDb, guildId: string, crafterId: string, lang: Lang): Promise<string[]> {
  const rows = await db.craftCompletion.findMany({ where: { guildId, crafterId }, orderBy: { doneAt: "desc" }, take: 15 });
  return rows.map((r) => `• <t:${Math.floor(r.doneAt.getTime() / 1000)}:d> ${r.quantity}× **${escapeMarkdown(r.item)}**${r.profession ? ` · ${professionName(lang, r.profession)}` : ""}${r.source === "game" ? " 🎮" : ""}`);
}

type BoardDb = LoadDb & Pick<PrismaClient, "guild" | "guildSettings" | "ladderSnapshot">;

const isBoard = (message: Message, botId: string) => isOwnBoard(message, botId, CRAFT_LADDER_MARKER, ["🔨 Top crafters", "🔨 Meilleurs artisans"]);

/** Draws the card and edits the saved message in place (or adopts or posts it). Never throws. */
export async function updateCraftLadder(db: BoardDb, discordGuild: DiscordGuild | null): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const guild = await db.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true, settings: { select: { craftLadderEnabled: true, craftLadderChannelId: true, craftLadderMessageId: true, language: true } } } });
    const settings = guild?.settings;
    if (!guild || !settings || settings.craftLadderEnabled === false || !settings.craftLadderChannelId) return false;
    const channel = await discordGuild.channels.fetch(settings.craftLadderChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const lang: Lang = settings.language === "fr" ? "fr" : "en";
    const { standings, total } = await loadCrafterStandings(db, guild.id);
    const moves = standings.length ? await trackRanks(db, guild.id, "crafters", standings.slice(0, LADDER_TOP).map((row) => row.memberId)) : null;
    const png = standings.length ? await scoreCardPng(craftLadderCard(standings, total, lang, new Date(), moves)).catch(() => null) : null;
    const payload = { embeds: [craftLadderEmbed(standings, lang, guild.id, png ? CRAFT_CARD_FILE : undefined).setTimestamp(new Date())],
      files: png ? [cardAttachment(png, CRAFT_CARD_FILE)] : [], allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.craftLadderMessageId ? await channel.messages.fetch(settings.craftLadderMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) existing = (await channel.messages.fetch({ limit: 50 }).catch(() => null))?.find((message) => isBoard(message, botId)) ?? null;
    if (existing?.editable) {
      await existing.edit({ ...payload, attachments: [] });
      if (existing.id !== settings.craftLadderMessageId) await db.guildSettings.update({ where: { guildId: guild.id }, data: { craftLadderMessageId: existing.id } });
    } else {
      const sent = await channel.send(payload);
      await db.guildSettings.update({ where: { guildId: guild.id }, data: { craftLadderMessageId: sent.id } });
    }
    return true;
  } catch (error) {
    console.error("Failed to update the craft ladder", error);
    return false;
  }
}
