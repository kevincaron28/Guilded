import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterName } from "./character-display.js";
import { cacheAllMembers } from "./member-cache.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";
import { RANK_MAX_AGE_MS } from "./rank-roles.js";

// 8.5 track C5: the promotion panel. Officers set a rule (default: in Discord, a linked character at rank "Initiate"
// for 7+ days, optional minimum level). The bot computes "Ready to promote" and "Not in Discord yet". Read-only:
// the promotion itself is an officer's click in game; after it, rank-roles.ts updates the Discord role by itself.
// On by default (owner decision, 6 November 2026); officers switch it off with /officer promotion.

export interface PromotionRule { enabled: boolean; fromRank: string; minDays: number; minLevel: number | null }
export const DEFAULT_PROMOTION_RULE: PromotionRule = { enabled: true, fromRank: "Initiate", minDays: 7, minLevel: null };

export interface PromotionCharacter { name: string; level: number | null; rankName: string | null; rankAt: Date | null; since: Date | null; isMain: boolean }
export interface PromotionPerson { discordUserId: string; displayName: string; inDiscord: boolean; characters: readonly PromotionCharacter[] }
export interface ReadyToPromote { discordUserId: string; displayName: string; character: string; days: number; level: number | null }
export interface PromotionPlan {
  ready: ReadyToPromote[];
  /** Linked members at the rank who left the Discord server. */
  left: { displayName: string; character: string }[];
  /** Guild characters at the rank that nobody in Discord has claimed (rank from the officer's last roster upload). */
  unclaimed: { name: string; level: number | null }[];
  /** Linked members at the rank that are not ready yet, with the days left. */
  waiting: { displayName: string; character: string; daysLeft: number }[];
}

const same = (a: string | null, b: string) => a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
const DAY = 86_400_000;

export function planPromotions(input: { people: readonly PromotionPerson[]; unclaimed: readonly { name: string; displayName?: string | null; level: number | null; rankName: string | null; rankAt: Date | null }[]; rule: PromotionRule; now?: Date }): PromotionPlan {
  const now = (input.now ?? new Date()).getTime();
  const fresh = (at: Date | null) => at !== null && now - at.getTime() <= RANK_MAX_AGE_MS;
  const plan: PromotionPlan = { ready: [], left: [], unclaimed: [], waiting: [] };
  for (const person of input.people) {
    const atRank = person.characters.filter((c) => same(c.rankName, input.rule.fromRank) && fresh(c.rankAt));
    if (!atRank.length) continue;
    // The character that has been at the rank longest (ties: the main) decides.
    const best = [...atRank].sort((a, b) => (a.since?.getTime() ?? now) - (b.since?.getTime() ?? now) || Number(b.isMain) - Number(a.isMain))[0]!;
    if (!person.inDiscord) { plan.left.push({ displayName: person.displayName, character: characterName(best) }); continue; }
    const days = Math.floor((now - (best.since?.getTime() ?? now)) / DAY);
    const levelOk = input.rule.minLevel === null || (best.level !== null && best.level >= input.rule.minLevel);
    if (days >= input.rule.minDays && levelOk) plan.ready.push({ discordUserId: person.discordUserId, displayName: person.displayName, character: characterName(best), days, level: best.level });
    else plan.waiting.push({ displayName: person.displayName, character: characterName(best), daysLeft: Math.max(0, input.rule.minDays - days) });
  }
  for (const row of input.unclaimed) if (same(row.rankName, input.rule.fromRank) && fresh(row.rankAt)) plan.unclaimed.push({ name: characterName(row as { name: string; displayName?: string | null }), level: row.level });
  plan.ready.sort((a, b) => b.days - a.days || a.displayName.localeCompare(b.displayName));
  plan.left.sort((a, b) => a.displayName.localeCompare(b.displayName));
  plan.unclaimed.sort((a, b) => a.name.localeCompare(b.name));
  plan.waiting.sort((a, b) => a.daysLeft - b.daysLeft || a.displayName.localeCompare(b.displayName));
  return plan;
}

type Db = Pick<PrismaClient, "guild" | "guildSettings" | "character" | "characterRankSeen" | "member" | "unclaimedCharacter">;

export function ruleFrom(settings: { promotionEnabled?: boolean | null; promotionFromRank?: string | null; promotionMinDays?: number | null; promotionMinLevel?: number | null } | null | undefined): PromotionRule {
  return { enabled: settings?.promotionEnabled !== false, fromRank: settings?.promotionFromRank?.trim() || DEFAULT_PROMOTION_RULE.fromRank, minDays: settings?.promotionMinDays ?? DEFAULT_PROMOTION_RULE.minDays, minLevel: settings?.promotionMinLevel ?? null };
}

/** Records when each linked character's current rank was first seen. A changed rank starts over; a new row starts at the link date. */
export async function observeRanks(db: Pick<PrismaClient, "character" | "characterRankSeen">, guildId: string, now = new Date()): Promise<void> {
  const characters = await db.character.findMany({
    where: { member: { guildId, status: "ACTIVE", isTest: false }, guildRankName: { not: null } },
    select: { id: true, guildRankName: true, createdAt: true, rankSeen: { select: { rankName: true } } }
  });
  for (const c of characters) {
    const rankName = c.guildRankName!;
    if (c.rankSeen?.rankName === rankName) continue;
    const since = c.rankSeen ? now : c.createdAt;
    await db.characterRankSeen.upsert({ where: { characterId: c.id }, create: { characterId: c.id, rankName, since }, update: { rankName, since } });
  }
}

export async function loadPromotionPlan(db: Db, discordGuild: Pick<DiscordGuild, "members" | "memberCount">, guildId: string, edition: string, now = new Date()): Promise<{ plan: PromotionPlan; rule: PromotionRule }> {
  const settings = await db.guildSettings.findUnique({ where: { guildId } });
  const rule = ruleFrom(settings);
  await observeRanks(db, guildId, now);
  await cacheAllMembers(discordGuild).catch(() => undefined);
  const [people, unclaimed] = await Promise.all([
    db.member.findMany({
      where: { guildId, status: "ACTIVE", isTest: false, characters: { some: { gameEdition: edition, guildRankName: { not: null } } } },
      select: { discordUserId: true, displayName: true, characters: { where: { gameEdition: edition }, select: { name: true, displayName: true, level: true, guildRankName: true, guildRankAt: true, isMain: true, rankSeen: { select: { since: true } } } } }
    }),
    db.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition, guildRankName: { not: null } }, select: { name: true, displayName: true, level: true, guildRankName: true, guildRankAt: true } })
  ]);
  const plan = planPromotions({
    people: people.map((p) => ({ discordUserId: p.discordUserId, displayName: p.displayName, inDiscord: discordGuild.members.cache.has(p.discordUserId),
      characters: p.characters.map((c) => ({ name: characterName(c), level: c.level, rankName: c.guildRankName, rankAt: c.guildRankAt, since: c.rankSeen?.since ?? null, isMain: c.isMain })) })),
    unclaimed: unclaimed.map((u) => ({ name: u.name, displayName: u.displayName, level: u.level, rankName: u.guildRankName, rankAt: u.guildRankAt })),
    rule, now
  });
  return { plan, rule };
}

export function formatPromotionPlan(plan: PromotionPlan, rule: PromotionRule, lang: "en" | "fr"): string {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const list = (items: string[], empty = "—") => items.length ? items.slice(0, 20).join("\n") + (items.length > 20 ? `\n+${items.length - 20}` : "") : empty;
  const rule1 = t(`Rule: rank **${rule.fromRank}** for ${rule.minDays}+ days${rule.minLevel ? `, level ${rule.minLevel}+` : ""}, in Discord with a linked character.`, `Règle : rang **${rule.fromRank}** depuis ${rule.minDays}+ jours${rule.minLevel ? `, niveau ${rule.minLevel}+` : ""}, dans Discord avec un personnage lié.`);
  return [rule1, "",
    `**${t("Ready to promote", "Prêts à être promus")}** (${plan.ready.length})`, list(plan.ready.map((r) => `• ${r.displayName} — ${r.character}${r.level ? ` ${r.level}` : ""} · ${r.days} ${t("days", "jours")}`)), "",
    `**${t("Not in Discord yet", "Pas encore dans Discord")}** (${plan.left.length + plan.unclaimed.length})`,
    list([...plan.left.map((r) => `• ${r.character} (${t("left the server", "a quitté le serveur")}: ${r.displayName})`), ...plan.unclaimed.map((r) => `• ${r.name}${r.level ? ` ${r.level}` : ""} (${t("no Discord link", "aucun lien Discord")})`)]), "",
    `**${t("Not yet", "Pas encore")}** (${plan.waiting.length})`, list(plan.waiting.slice(0, 10).map((r) => `• ${r.displayName} — ${r.character} · ${t(`${r.daysLeft} day(s) left`, `${r.daysLeft} jour(s) restant(s)`)}`))
  ].join("\n").slice(0, 3900);
}

// The weekly post: one message in the officer channel (or the log channel) when someone is ready. On by default,
// at most once every 7 days, never when nobody is ready.
export async function postWeeklyPromotions(db: Db & Pick<PrismaClient, "guildSettings">, discordGuild: DiscordGuild, now = new Date()): Promise<boolean> {
  const guild = await db.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true, gameEdition: true, settings: true } });
  const settings = guild?.settings;
  if (!guild || !settings || settings.promotionEnabled === false || settings.promotionWeeklyEnabled === false) return false;
  if (settings.promotionLastPostAt && now.getTime() - settings.promotionLastPostAt.getTime() < 7 * DAY - 3_600_000) return false;
  const channelId = settings.promotionChannelId ?? settings.logChannelId;
  if (!channelId) return false;
  const { plan, rule } = await loadPromotionPlan(db, discordGuild, guild.id, guild.gameEdition ?? "forever", now);
  if (!plan.ready.length) return false;
  const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return false;
  const lang = settings.language === "fr" ? "fr" : "en";
  const embed = new EmbedBuilder().setColor(0x2f855a).setTitle(lang === "fr" ? "⬆️ Promotions possibles" : "⬆️ Ready to promote").setDescription(formatPromotionPlan(plan, rule, lang));
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  await db.guildSettings.update({ where: { guildId: guild.id }, data: { promotionLastPostAt: now } });
  return true;
}

export async function postAllWeeklyPromotions(db: Db, guilds: Iterable<DiscordGuild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) await forEachGuildScope(db as PrismaClient, guild.id, () => postWeeklyPromotions(db, guild)).catch(report);
}
