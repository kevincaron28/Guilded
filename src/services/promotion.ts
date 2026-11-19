import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterName, displayCharacterName, fullNameBook, cleanCharacterName } from "./character-display.js";
import { cacheAllMembers } from "./member-cache.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";
import { RANK_MAX_AGE_MS } from "./rank-roles.js";
import { addonName } from "./addon-name.js";
import { postToLogChannel } from "./housekeeping.js";

// 8.5 track C5: the promotion panel. Officers set a rule (default: in Discord, a linked character at rank "Initiate"
// for 7+ days, optional minimum level). The bot computes "Ready to promote" and "Not in Discord yet". Read-only:
// the promotion itself is an officer's click in game; after it, rank-roles.ts updates the Discord role by itself.
// On by default (owner decision, 6 November 2026); officers switch it off with /officer promotion.

// Owner decision (19 Nov 2026): "link your character, stay linked 7 days, be present on Discord and in voice". Ready also needs
// a linked character (reported counts like confirmed; detached characters are not linked) and, by default, 3 hours of voice in
// the last 7 days. Both switch off per server: requireLink false, minVoiceMinutes 0.
export interface PromotionRule { enabled: boolean; fromRank: string; minDays: number; minLevel: number | null; requireLink: boolean; /** 0 = no voice condition. */ minVoiceMinutes: number }
export const DEFAULT_PROMOTION_RULE: PromotionRule = { enabled: true, fromRank: "Initiate", minDays: 7, minLevel: null, requireLink: true, minVoiceMinutes: 180 };
/** Voice window for the rule, in days (today included). */
export const PROMOTION_VOICE_DAYS = 7;
/** Compact reason codes the feed carries to the addon: "link" and "voice:<have minutes>:<need minutes>", comma separated. */
export function formatVoiceDuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`) : `${m} min`;
}
/** A waiting row's reason in the server language ("voice 1 h 10 / 2 h"), "" when there is none. */
export function describeReason(reason: string | undefined, lang: "en" | "fr"): string {
  const m = /^voice:(\d+):(\d+)$/.exec(reason ?? "");
  if (m) return `${lang === "fr" ? "vocal" : "voice"} ${formatVoiceDuration(Number(m[1]))} / ${formatVoiceDuration(Number(m[2]))}`;
  return reason === "link" ? (lang === "fr" ? "lien requis" : "needs link") : "";
}

export interface PromotionCharacter { /** The name the addon sees in the guild roster. */ addon?: string; name: string; level: number | null; rankName: string | null; rankAt: Date | null; since: Date | null; isMain: boolean }
export interface PromotionPerson { discordUserId: string; displayName: string; inDiscord: boolean; /** Voice minutes over the last 7 days, shared by all the member's characters. Missing counts as 0. */ voiceMinutes?: number; characters: readonly PromotionCharacter[] }
export interface ReadyToPromote { discordUserId: string; displayName: string; character: string; /** The in-game roster name (addonName). */ addon?: string | undefined; days: number; level: number | null }
export interface PromotionPlan {
  ready: ReadyToPromote[];
  /** Linked members at the rank who left the Discord server. */
  left: { displayName: string; character: string }[];
  /** Guild characters at the rank that nobody in Discord has claimed (rank from the officer's last roster upload). */
  unclaimed: { name: string; /** The in-game roster name (addonName). */ addon?: string | undefined; level: number | null }[];
  /** Linked members at the rank that are not ready yet, with the days left. */
  waiting: { displayName: string; character: string; /** The in-game roster name (addonName). */ addon?: string | undefined; daysLeft: number; /** Why not ready besides days: "link", "voice:<have>:<need>" (minutes), comma separated. */ reason?: string | undefined }[];
}

/**
 * Owner rule (16 Nov 2026): the Alt rank is never promoted. Rank names that mean "alt character", English and French,
 * compared without case or accents: Alt, Alts, Alt (...), Reroll, Rerolls, Re-roll, Twink. The addon keeps a copy
 * of this list (RosterTools.lua, isAltRank); tests/promotion.test.ts and tests/lua/promotion-rework.test.ts pin both.
 */
export const ALT_RANK_NAMES = ["alt", "alts", "reroll", "rerolls", "re-roll", "re-rolls", "twink", "twinks"] as const;
export function isAltRank(rankName: string | null | undefined): boolean {
  if (!rankName) return false;
  const plain = rankName.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return ALT_RANK_NAMES.some((name) => plain === name || (plain.startsWith(name) && !/^[a-z]/.test(plain.slice(name.length))));
}

const same = (a: string | null, b: string) => a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
const DAY = 86_400_000;

export function planPromotions(input: { people: readonly PromotionPerson[]; unclaimed: readonly { name: string; addon?: string | undefined; displayName?: string | null; level: number | null; rankName: string | null; rankAt: Date | null }[]; rule: PromotionRule; now?: Date }): PromotionPlan {
  const now = (input.now ?? new Date()).getTime();
  const fresh = (at: Date | null) => at !== null && now - at.getTime() <= RANK_MAX_AGE_MS;
  const plan: PromotionPlan = { ready: [], left: [], unclaimed: [], waiting: [] };
  // Never promote out of an alt rank, whatever the rule says.
  if (isAltRank(input.rule.fromRank)) return plan;
  for (const person of input.people) {
    // A member with a main: only the main is promoted; their other characters are alts even at the starting rank.
    const hasMain = person.characters.some((c) => c.isMain);
    const atRank = person.characters.filter((c) => same(c.rankName, input.rule.fromRank) && fresh(c.rankAt) && !isAltRank(c.rankName) && (!hasMain || c.isMain));
    if (!atRank.length) continue;
    // The character that has been at the rank longest (ties: the main) decides.
    const best = [...atRank].sort((a, b) => (a.since?.getTime() ?? now) - (b.since?.getTime() ?? now) || Number(b.isMain) - Number(a.isMain))[0]!;
    if (!person.inDiscord) { plan.left.push({ displayName: person.displayName, character: characterName(best) }); continue; }
    const days = Math.floor((now - (best.since?.getTime() ?? now)) / DAY);
    const levelOk = input.rule.minLevel === null || (best.level !== null && best.level >= input.rule.minLevel);
    const have = Math.max(0, Math.floor(person.voiceMinutes ?? 0));
    const voiceOk = input.rule.minVoiceMinutes <= 0 || have >= input.rule.minVoiceMinutes;
    if (days >= input.rule.minDays && levelOk && voiceOk) plan.ready.push({ discordUserId: person.discordUserId, displayName: person.displayName, character: characterName(best), addon: best.addon, days, level: best.level });
    else plan.waiting.push({ displayName: person.displayName, character: characterName(best), addon: best.addon, daysLeft: Math.max(0, input.rule.minDays - days), ...(voiceOk ? {} : { reason: `voice:${have}:${input.rule.minVoiceMinutes}` }) });
  }
  for (const row of input.unclaimed) if (same(row.rankName, input.rule.fromRank) && fresh(row.rankAt) && !isAltRank(row.rankName)) plan.unclaimed.push({ name: characterName(row as { name: string; displayName?: string | null }), addon: row.addon, level: row.level });
  plan.ready.sort((a, b) => b.days - a.days || a.displayName.localeCompare(b.displayName));
  plan.left.sort((a, b) => a.displayName.localeCompare(b.displayName));
  plan.unclaimed.sort((a, b) => a.name.localeCompare(b.name));
  plan.waiting.sort((a, b) => a.daysLeft - b.daysLeft || a.displayName.localeCompare(b.displayName));
  return plan;
}

type Db = Pick<PrismaClient, "guild" | "guildSettings" | "character" | "characterRankSeen" | "member" | "unclaimedCharacter" | "memberVoiceHour">;

export function ruleFrom(settings: { promotionEnabled?: boolean | null; promotionFromRank?: string | null; promotionMinDays?: number | null; promotionMinLevel?: number | null; promotionRequireLink?: boolean | null; promotionMinVoiceMinutes?: number | null } | null | undefined): PromotionRule {
  return { enabled: settings?.promotionEnabled !== false, fromRank: settings?.promotionFromRank?.trim() || DEFAULT_PROMOTION_RULE.fromRank, minDays: settings?.promotionMinDays ?? DEFAULT_PROMOTION_RULE.minDays, minLevel: settings?.promotionMinLevel ?? null, requireLink: settings?.promotionRequireLink !== false, minVoiceMinutes: Math.max(0, settings?.promotionMinVoiceMinutes ?? DEFAULT_PROMOTION_RULE.minVoiceMinutes) };
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
      select: { discordUserId: true, displayName: true, characters: { where: { gameEdition: edition }, select: { name: true, realm: true, displayName: true, level: true, guildRankName: true, guildRankAt: true, isMain: true, rankSeen: { select: { since: true } } } } }
    }),
    db.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition, guildRankName: { not: null } }, select: { name: true, realm: true, displayName: true, level: true, guildRankName: true, guildRankAt: true } })
  ]);
  // Raw voice time over the last 7 days (services/voice-time.ts: solo time counts, the AFK channel does not); a Discord account's alts share it.
  const voice = new Map<string, number>();
  if (rule.minVoiceMinutes > 0 && people.length) {
    const rows = await db.memberVoiceHour.groupBy({ by: ["userId"], where: { guildId, userId: { in: people.map((p) => p.discordUserId) }, hour: { gte: new Date(now.getTime() - PROMOTION_VOICE_DAYS * DAY) } }, _sum: { seconds: true } });
    for (const row of rows) voice.set(row.userId, Math.floor((row._sum.seconds ?? 0) / 60));
  }
  const book = fullNameBook([...people.flatMap((p) => p.characters), ...unclaimed]);
  const plan = planPromotions({
    people: people.map((p) => ({ discordUserId: p.discordUserId, displayName: p.displayName, inDiscord: discordGuild.members.cache.has(p.discordUserId), voiceMinutes: voice.get(p.discordUserId) ?? 0,
      characters: p.characters.map((c) => ({ addon: addonName(c.name, c.realm), name: displayCharacterName(c, book), level: c.level, rankName: c.guildRankName, rankAt: c.guildRankAt, since: c.rankSeen?.since ?? null, isMain: c.isMain })) })),
    unclaimed: unclaimed.map((u) => ({ name: displayCharacterName(u, book), addon: addonName(u.name, u.realm), displayName: null, level: u.level, rankName: u.guildRankName, rankAt: u.guildRankAt })),
    rule, now
  });
  return { plan, rule };
}

export function formatPromotionPlan(plan: PromotionPlan, rule: PromotionRule, lang: "en" | "fr"): string {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const list = (items: string[], empty = "—") => items.length ? items.slice(0, 20).join("\n") + (items.length > 20 ? `\n+${items.length - 20}` : "") : empty;
  const rule1 = t(`Rule: rank **${rule.fromRank}** for ${rule.minDays}+ days${rule.minLevel ? `, level ${rule.minLevel}+` : ""}, in Discord with a linked character${rule.minVoiceMinutes > 0 ? `, ${formatVoiceDuration(rule.minVoiceMinutes)} in voice over the last 7 days` : ""}.`, `Règle : rang **${rule.fromRank}** depuis ${rule.minDays}+ jours${rule.minLevel ? `, niveau ${rule.minLevel}+` : ""}, dans Discord avec un personnage lié${rule.minVoiceMinutes > 0 ? `, ${formatVoiceDuration(rule.minVoiceMinutes)} en vocal sur les 7 derniers jours` : ""}.`);
  return [rule1, "",
    `**${t("Ready to promote", "Prêts à être promus")}** (${plan.ready.length})`, list(plan.ready.map((r) => `• ${r.displayName} — ${cleanCharacterName(r.character)}${r.level ? ` ${r.level}` : ""} · ${r.days} ${t("days", "jours")}`)), "",
    `**${t("Not in Discord yet", "Pas encore dans Discord")}** (${plan.left.length + plan.unclaimed.length})`,
    list([...plan.left.map((r) => `• ${cleanCharacterName(r.character)} (${t("left the server", "a quitté le serveur")}: ${r.displayName})`), ...plan.unclaimed.map((r) => `• ${r.name}${r.level ? ` ${r.level}` : ""} (${t("no Discord link", "aucun lien Discord")})`)]), "",
    `**${t("Not yet", "Pas encore")}** (${plan.waiting.length})`, list(plan.waiting.slice(0, 10).map((r) => `• ${r.displayName} — ${cleanCharacterName(r.character)} · ${[r.daysLeft > 0 ? t(`${r.daysLeft} day(s) left`, `${r.daysLeft} jour(s) restant(s)`) : "", describeReason(r.reason, lang)].filter(Boolean).join(" · ") || "—"}`))
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

/** The officer-log line for one promotion (server language). */
export function promotionLogLine(name: string, rankName: string, lang: "en" | "fr"): string {
  return lang === "fr" ? `⬆️ ${name} a été promu(e) au rang ${rankName}.` : `⬆️ ${name} was promoted to ${rankName}.`;
}

/** Officer log only (owner decision, 16 Nov 2026): no public message and no guild-chat line. At most 10 lines per upload. */
export async function announcePromotions(discordGuild: DiscordGuild, promotions: readonly { name: string; rankName: string }[]): Promise<void> {
  for (const p of promotions.slice(0, 10)) await postToLogChannel(discordGuild, (lang) => promotionLogLine(cleanCharacterName(p.name), p.rankName, lang));
}
