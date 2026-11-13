import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { classOf, type ClassBook } from "./ladder-classes.js";
import { classColor, ladderMeta, type ScoreCard } from "./score-card.js";

// World PvP board (9.1, docs/WORLD_PVP.md stages 2 and 3). The addon (Modules/WorldPvP.lua) counts the member's own open-world
// kills, defends and calls answered per raid week; the companion carries them here. The numbers come from the member's own
// game, so they are capped before they rank anyone:
//   - kills: at most WEEKLY_KILL_CAP a week, and a victim beyond REPEAT_VICTIM_LIMIT kills in the member's recent list stops counting;
//   - helped (calls answered): at most the calls other guildmates really made that week (GuildHelpCall);
//   - defends: at most helped and at most the kills.
// Deaths are never uploaded or shown (owner default, 7 November 2026). A re-upload can only raise a number.

export const WEEK_SECONDS = 7 * 86_400;
/** The addon's weeks start on Tuesday 15:00 UTC, counted from the epoch (a Thursday). Same formula as Modules/WorldPvP.lua. */
export const WEEK_OFFSET_SECONDS = 5 * 86_400 + 15 * 3_600;
export const WEEKLY_KILL_CAP = 300;
export const REPEAT_VICTIM_LIMIT = 3;
const TOP = 5, CARD_TOP = 10;
export const WORLD_PVP_CARD_FILE = "world-pvp.png";
export const WORLD_PVP_MARKER = "Guilded world PvP";

export const weekKeyOf = (when: Date) => Math.floor((Math.floor(when.getTime() / 1000) - WEEK_OFFSET_SECONDS) / WEEK_SECONDS);
export const weekRange = (weekKey: number) => ({
  from: new Date((weekKey * WEEK_SECONDS + WEEK_OFFSET_SECONDS) * 1000),
  to: new Date(((weekKey + 1) * WEEK_SECONDS + WEEK_OFFSET_SECONDS) * 1000)
});

const count = z.number().int().min(0).max(1_000_000);
export const worldPvpUploadSchema = z.object({
  weekKey: z.number().int().min(0).max(100_000),
  kills: count, defends: count, responded: count,
  recent: z.array(z.object({ n: z.string().min(1).max(40), at: z.number().int().min(0).max(4_000_000_000), d: z.number().int().min(0).max(1).optional() })).max(30).default([])
});
export type WorldPvpUpload = z.infer<typeof worldPvpUploadSchema>;

/** Pure: the valid blocks of an upload (this week and, after the Tuesday reset, the week before), one per week. Anything malformed is left out; it never fails the upload. */
export function parseWorldPvpUploads(value: unknown): WorldPvpUpload[] {
  const blocks = new Map<number, WorldPvpUpload>();
  for (const raw of Array.isArray(value) ? value : []) {
    const parsed = worldPvpUploadSchema.safeParse(raw);
    if (parsed.success && !blocks.has(parsed.data.weekKey)) blocks.set(parsed.data.weekKey, parsed.data);
  }
  return [...blocks.values()];
}

/** Pure: the first valid block of an upload, or null. */
export function parseWorldPvpUpload(value: unknown): WorldPvpUpload | null {
  return parseWorldPvpUploads(value)[0] ?? null;
}

export interface WorldPvpCounts { kills: number; defends: number; helped: number }

/**
 * Pure: the counted numbers for one member and week. `guildCalls` is the number of calls for help made by other guildmates that week.
 * Kills beyond the repeat limit for one victim in `recent` are taken off the total.
 */
export function cappedCounts(upload: Pick<WorldPvpUpload, "kills" | "defends" | "responded" | "recent">, guildCalls: number): WorldPvpCounts {
  const perVictim = new Map<string, number>();
  for (const row of upload.recent) perVictim.set(row.n.toLowerCase(), (perVictim.get(row.n.toLowerCase()) ?? 0) + 1);
  let excess = 0;
  for (const n of perVictim.values()) if (n > REPEAT_VICTIM_LIMIT) excess += n - REPEAT_VICTIM_LIMIT;
  const kills = Math.max(0, Math.min(WEEKLY_KILL_CAP, upload.kills - excess));
  const helped = Math.max(0, Math.min(upload.responded, guildCalls));
  const defends = Math.max(0, Math.min(upload.defends, helped, kills));
  return { kills, defends, helped };
}

type ApplyDb = Pick<PrismaClient, "guildSettings" | "member" | "worldPvpWeek" | "guildHelpCall">;

/**
 * Stores the member's week. Only the current and the previous week are accepted (a late upload, never a made-up future or old week).
 * Each number only goes up. Returns whether anything changed.
 */
export async function applyWorldPvpUpload(db: ApplyDb, guildId: string, memberId: string, upload: WorldPvpUpload | readonly WorldPvpUpload[] | null, now = new Date()): Promise<boolean> {
  if (!upload) return false;
  // Every block is stored on its own; the week before is the late upload of a session that crossed the Tuesday reset.
  if (Array.isArray(upload)) {
    let changed = false;
    for (const block of upload as readonly WorldPvpUpload[]) if (await applyWorldPvpUpload(db, guildId, memberId, block, now)) changed = true;
    return changed;
  }
  upload = upload as WorldPvpUpload;
  const current = weekKeyOf(now);
  if (upload.weekKey > current || upload.weekKey < current - 1) return false;
  const [settings, member] = await Promise.all([
    db.guildSettings.findUnique({ where: { guildId }, select: { worldPvpEnabled: true } }),
    db.member.findUnique({ where: { id: memberId }, select: { guildId: true } })
  ]);
  if (!member || member.guildId !== guildId || settings?.worldPvpEnabled === false) return false;
  const range = weekRange(upload.weekKey);
  const guildCalls = await db.guildHelpCall.count({ where: { guildId, memberId: { not: memberId }, calledAt: { gte: range.from, lt: range.to } } });
  const inWeek = upload.recent.filter(row => row.at * 1000 >= range.from.getTime() && row.at * 1000 < range.to.getTime());
  const next = cappedCounts({ ...upload, recent: inWeek }, guildCalls);
  if (!next.kills && !next.defends && !next.helped) return false;
  const where = { guildId_memberId_weekKey: { guildId, memberId, weekKey: upload.weekKey } };
  const existing = await db.worldPvpWeek.findUnique({ where, select: { kills: true, defends: true, helped: true } });
  const merged = { kills: Math.max(existing?.kills ?? 0, next.kills), defends: Math.max(existing?.defends ?? 0, next.defends), helped: Math.max(existing?.helped ?? 0, next.helped) };
  if (existing && existing.kills === merged.kills && existing.defends === merged.defends && existing.helped === merged.helped) return false;
  await db.worldPvpWeek.upsert({ where, create: { guildId, memberId, weekKey: upload.weekKey, ...merged }, update: merged });
  return true;
}

export interface WorldPvpStanding extends WorldPvpCounts { memberId: string; name: string }
export interface WorldPvpData { weekKey: number; standings: WorldPvpStanding[] }

/** Pure: kills, then defends, then calls answered, then name. Members with nothing are left out. */
export function worldPvpStandings(rows: readonly (WorldPvpCounts & { memberId: string })[], names: ReadonlyMap<string, string>): WorldPvpStanding[] {
  return rows.filter(row => row.kills || row.defends || row.helped).map(row => ({ ...row, name: names.get(row.memberId) ?? "?" }))
    .sort((a, b) => b.kills - a.kills || b.defends - a.defends || b.helped - a.helped || a.name.localeCompare(b.name));
}

export async function loadWorldPvpData(db: Pick<PrismaClient, "worldPvpWeek" | "member"> & Partial<Pick<PrismaClient, "unclaimedCharacter" | "guildRosterEntry" | "character">>, guildId: string, edition: string, now = new Date()): Promise<WorldPvpData> {
  const weekKey = weekKeyOf(now);
  const rows = await db.worldPvpWeek.findMany({ where: { guildId, weekKey, member: { guildId, status: "ACTIVE" } }, select: { memberId: true, kills: true, defends: true, helped: true } });
  const members = await db.member.findMany({ where: { id: { in: rows.map(row => row.memberId) } }, select: { id: true, displayName: true, characters: { where: { gameEdition: edition }, orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 1, select: { name: true, displayName: true } } } });
  const book = await loadFullNameBook(db as never, guildId);
  const names = new Map(members.map(member => [member.id, member.characters?.[0] ? displayCharacterName(member.characters[0], book) : member.displayName]));
  return { weekKey, standings: worldPvpStandings(rows, names) };
}

/** Pure: the shared ladder layout, one panel with the week's top 10. */
export function worldPvpCard(data: WorldPvpData, lang: Lang, classes: ClassBook = new Map(), updatedAt = new Date()): ScoreCard {
  const fr = lang === "fr";
  return {
    eyebrow: `Guilded · ${fr ? "JcJ" : "PvP"}`, title: fr ? "JcJ en monde ouvert" : "World PvP",
    subtitle: fr ? "Cette semaine (reset du mardi) · victoires, défenses et appels à l'aide" : "This week (Tuesday reset) · kills, defends and calls answered",
    backdrop: { kind: "board", key: "world-pvp" },
    stats: [], footer: fr ? "Compteurs des joueurs, plafonnés · distinct des champs de bataille et des duels · aucun point ni récompense" : "Player counters, capped · separate from battlegrounds and duels · no points or awards",
    ladder: {
      meta: ladderMeta(lang, updatedAt), empty: fr ? "Aucune activité JcJ en monde ouvert cette semaine." : "No open-world PvP this week yet.",
      columns: [{ label: fr ? "Vict." : "Kills", width: 52, primary: true }, { label: fr ? "Déf." : "Def.", width: 46 }, { label: fr ? "Aide" : "Helped", width: 52 }],
      boards: [{ rows: data.standings.slice(0, CARD_TOP).map((player, index) => ({ rank: index + 1, name: player.name, color: classColor(classOf(classes, player.name)),
        values: [String(player.kills), String(player.defends), String(player.helped)] })) }]
    }
  };
}

/** Pure: the second embed on the PvP ladder message. With `image`, the card holds the table and the embed keeps the summary. */
export function worldPvpEmbed(data: WorldPvpData, lang: Lang, image?: string): EmbedBuilder {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 32);
  const embed = new EmbedBuilder().setColor(0xb91c1c).setTitle(t("⚔️ World PvP this week", "⚔️ JcJ en monde ouvert cette semaine"));
  if (!data.standings.length) {
    embed.setDescription(t("No open-world PvP yet this week. Kills, defends and calls answered come from members' Guilded addon.", "Aucune activité JcJ en monde ouvert cette semaine. Les victoires, défenses et appels viennent de l'addon Guilded des membres."));
  } else {
    embed.setDescription(t("Open-world kills, then defends (kills after answering a guildmate's call for help), then calls answered. Resets with the raid week.", "Victoires en monde ouvert, puis défenses (victoires après avoir répondu à un appel à l'aide), puis appels répondus. Remise à zéro avec la semaine de raid."));
    if (!image) {
      const rows = data.standings.slice(0, TOP).map((p, i) => `${["🥇", "🥈", "🥉"][i] ?? `**${i + 1}.**`} ${name(p.name)} — ${p.kills} ${t("kills", "victoires")} · ${p.defends} ${t("defends", "défenses")} · ${p.helped} ${t("answered", "répondus")}`);
      embed.addFields({ name: t("Top this week", "Meilleurs de la semaine"), value: rows.join("\n").slice(0, 1024) });
    }
  }
  if (image && data.standings.length) embed.setImage(`attachment://${image}`);
  return embed.setFooter({ text: t("Counted by members' Guilded addon, capped each week · no points or awards", "Comptés par l'addon Guilded des membres, plafonnés chaque semaine · aucun point ni récompense") });
}
