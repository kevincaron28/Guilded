import { EmbedBuilder } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterName, cleanCharacterName } from "./character-display.js";
import { RANK_MAX_AGE_MS } from "./rank-roles.js";
import { PROMOTION_VOICE_DAYS, formatVoiceDuration, isAltRank, ruleFrom, type PromotionRule } from "./promotion.js";

// A member's own progress toward the promotion rule (services/promotion.ts), shown privately by `/promotion status` and by
// the "Where am I?" button under the officers' announcement (`/officer promotion post`). Read-only.

export const PROMOTION_STATUS_BUTTON = "promotion:status";
const DAY = 86_400_000;
type Lang = "en" | "fr";

export interface ProgressCharacter { name: string; displayName?: string | null; guildRankName: string | null; guildRankAt: Date | null; since: Date | null; level: number | null; isMain: boolean }
export interface PromotionProgress {
  state: "off" | "above" | "progress";
  rule: PromotionRule;
  /** Rank of the character that is already above the starting rank (state "above"). */
  rank?: string;
  linked: boolean;
  character?: string;
  /** Days at the starting rank; null = the character is not in the guild roster the bot last saw. */
  days: number | null;
  level: number | null;
  voiceMinutes: number;
  /** Every condition holds: the member is on the list at the next officer pass. */
  ready: boolean;
}

/** Pure: one member's progress from their linked characters (alts included) and their voice minutes over the last 7 days. */
export function evaluateProgress(input: { rule: PromotionRule; characters: readonly ProgressCharacter[]; voiceMinutes: number; now: Date }): PromotionProgress {
  const { rule, characters, now } = input;
  const linked = characters.length > 0;
  const base = { rule, voiceMinutes: input.voiceMinutes, linked, days: null as number | null, level: null as number | null, ready: false };
  if (!rule.enabled) return { ...base, state: "off" };
  const same = (a: string | null) => a !== null && a.trim().toLowerCase() === rule.fromRank.trim().toLowerCase();
  const fresh = (at: Date | null) => at !== null && now.getTime() - at.getTime() <= RANK_MAX_AGE_MS;
  const hasMain = characters.some((c) => c.isMain);
  const pool = characters.filter((c) => !hasMain || c.isMain);
  const atRank = pool.filter((c) => same(c.guildRankName) && fresh(c.guildRankAt) && !isAltRank(c.guildRankName));
  const above = pool.find((c) => c.guildRankName && fresh(c.guildRankAt) && !same(c.guildRankName) && !isAltRank(c.guildRankName));
  if (!atRank.length && above) return { ...base, state: "above", rank: above.guildRankName!, character: cleanCharacterName(characterName(above)) };
  const best = [...atRank].sort((a, b) => (a.since?.getTime() ?? now.getTime()) - (b.since?.getTime() ?? now.getTime()) || Number(b.isMain) - Number(a.isMain))[0] ?? pool[0] ?? characters[0];
  const days = atRank.length && best ? Math.max(0, Math.floor((now.getTime() - (best.since?.getTime() ?? now.getTime())) / DAY)) : null;
  const voiceOk = rule.minVoiceMinutes <= 0 || input.voiceMinutes >= rule.minVoiceMinutes;
  const levelOk = rule.minLevel === null || (best?.level != null && best.level >= rule.minLevel);
  const linkOk = !rule.requireLink || linked;
  return { ...base, state: "progress", ...(best ? { character: cleanCharacterName(characterName(best)) } : {}), days, level: best?.level ?? null, ready: linkOk && days !== null && days >= rule.minDays && levelOk && voiceOk };
}

/** How to link: the bot DM, plus the server's invite channel when one is set (a full name typed there pre-links, invite-prelink.ts). */
function linkHow(lang: Lang, inviteChannelId?: string | null): string {
  const ch = inviteChannelId ? `<#${inviteChannelId}>` : "";
  return lang === "fr" ? `Envoyez le nom complet de votre perso (Prénom Nom) en message privé au bot${ch ? `, ou écrivez-le dans ${ch}` : ""}.`
    : `DM your character's full name (First Last) to the bot${ch ? `, or type it in ${ch}` : ""}.`;
}

export function formatProgress(p: PromotionProgress, lang: Lang, inviteChannelId?: string | null): string {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  if (p.state === "off") return t("The promotion rule is switched off on this server.", "La règle de promotion est désactivée sur ce serveur.");
  if (p.state === "above") return t(`You're already ${p.rank}. Nothing left to do.`, `Vous êtes déjà ${p.rank}. Il ne reste rien à faire.`);
  const { rule } = p;
  const lines: string[] = [];
  const who = cleanCharacterName(p.character ?? "");
  if (rule.requireLink) {
    lines.push(p.linked ? `✅ ${t("Character linked", "Personnage lié")}: **${who}**`
      : `❌ ${t("No character linked.", "Aucun personnage lié.")} ${linkHow(lang, inviteChannelId)}`);
  }
  if (p.days === null) lines.push(`❌ ${t(`Days as ${rule.fromRank}: not in the guild roster yet (the bot sees you after an officer's roster upload).`, `Jours comme ${rule.fromRank} : pas encore dans le roster de la guilde (le bot te voit après le téléversement d'un officier).`)}`);
  else lines.push(`${p.days >= rule.minDays ? "✅" : "❌"} ${t(`Days as ${rule.fromRank}`, `Jours comme ${rule.fromRank}`)}: ${p.days} / ${rule.minDays}`);
  if (rule.minLevel) lines.push(`${p.level !== null && p.level >= rule.minLevel ? "✅" : "❌"} ${t("Level", "Niveau")}: ${p.level ?? "?"} / ${rule.minLevel}`);
  if (rule.minVoiceMinutes > 0) lines.push(`${p.voiceMinutes >= rule.minVoiceMinutes ? "✅" : "❌"} ${t(`Voice, last ${PROMOTION_VOICE_DAYS} days`, `Vocal, ${PROMOTION_VOICE_DAYS} derniers jours`)}: ${formatVoiceDuration(p.voiceMinutes)} / ${formatVoiceDuration(rule.minVoiceMinutes)} ${t("(solo time counts)", "(seul, ça compte)")}`);
  lines.push("", p.ready ? t("🎉 You're on the list to be promoted at the next officer pass.", "🎉 Vous êtes sur la liste pour être promu à la prochaine passe des officiers.") : t("Not yet: finish the ❌ items above.", "Pas encore : termine les points ❌ ci-dessus."));
  return lines.join("\n");
}

type Db = Pick<PrismaClient, "guildSettings" | "member" | "memberVoiceHour">;

export async function promotionProgressFor(db: Db, guildId: string, discordUserId: string, edition: string, now = new Date()): Promise<{ text: string; progress: PromotionProgress; lang: Lang }> {
  const settings = await db.guildSettings.findUnique({ where: { guildId } });
  const rule = ruleFrom(settings);
  const lang: Lang = settings?.language === "fr" ? "fr" : "en";
  const member = await db.member.findFirst({
    where: { guildId, discordUserId, status: "ACTIVE", isTest: false },
    select: { characters: { where: { gameEdition: edition, detachedAt: null }, select: { name: true, displayName: true, level: true, guildRankName: true, guildRankAt: true, isMain: true, rankSeen: { select: { since: true } } } } }
  });
  let voiceMinutes = 0;
  if (member && rule.enabled && rule.minVoiceMinutes > 0) {
    const sum = await db.memberVoiceHour.aggregate({ where: { guildId, userId: discordUserId, hour: { gte: new Date(now.getTime() - PROMOTION_VOICE_DAYS * DAY) } }, _sum: { seconds: true } });
    voiceMinutes = Math.floor((sum._sum.seconds ?? 0) / 60);
  }
  const characters = (member?.characters ?? []).map((c) => ({ name: c.name, displayName: c.displayName, level: c.level, guildRankName: c.guildRankName, guildRankAt: c.guildRankAt, since: c.rankSeen?.since ?? null, isMain: c.isMain }));
  const progress = evaluateProgress({ rule, characters, voiceMinutes, now });
  return { text: formatProgress(progress, lang, settings?.inviteChannelId), progress, lang };
}

/** The announcement embed. title, intro (opening) and note (closing line) are the officer's own optional wording; the defaults are neutral. */
export function promotionAnnouncement(rule: PromotionRule, lang: Lang, custom: { title?: string | null; intro?: string | null; note?: string | null; inviteChannelId?: string | null } = {}): EmbedBuilder {
  const { intro, note, title } = custom;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const steps: string[] = [];
  const marks = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
  const num = () => marks[steps.length]!;
  if (rule.requireLink) steps.push(`${num()} ${t("Link your character: ", "Liez votre perso : ")}${linkHow(lang, custom.inviteChannelId)}`);
  steps.push(`${num()} ${t(`Stay ${rule.fromRank}${rule.requireLink ? " and linked" : ""} for ${rule.minDays} days.`, `Reste ${rule.fromRank}${rule.requireLink ? " lié" : ""} pendant ${rule.minDays} jours.`)}`);
  if (rule.minVoiceMinutes > 0) steps.push(`${num()} ${t(`Spend at least ${formatVoiceDuration(rule.minVoiceMinutes)} in voice every week (even alone in a channel, it counts).`, `Passez au moins ${formatVoiceDuration(rule.minVoiceMinutes)} dans le vocal par semaine (même seul dans un channel, ça compte).`)}`);
  const opening = intro?.trim() || t("We want an active guild, not just a list of names.", "On veut une guilde vivante, pas juste une liste de noms.");
  return new EmbedBuilder().setColor(0xd4af37)
    .setTitle(title?.trim() || t("📣 How to get promoted", "📣 Comment être promu"))
    .setDescription([opening, "", `**${t(`To go from ${rule.fromRank} to the next rank:`, `Pour passer ${/^[aeiouyhàâéèêëîïôûù]/i.test(rule.fromRank) ? "d'" : "de "}${rule.fromRank} au rang suivant :`)}**`, ...steps, ...(note?.trim() ? [note.trim(), ""] : []), t("Click “Where am I?” to see what you still need.", "Cliquez sur « Où j'en suis ? » pour voir ce qu'il vous manque.")].join("\n").slice(0, 3900));
}
