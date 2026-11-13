import type { AttachmentBuilder, Guild, GuildMember } from "discord.js";
import type { Lang } from "../i18n.js";
import { cardAttachment } from "./card-alt.js";
import { downloadImage, withDiscordMember } from "./card-member.js";
import { scoreCardPng, type ScoreCard } from "./score-card.js";

// The welcome card (9.3). The welcome message already exists and is opt-in (a welcome channel or DMs configured by the officers), so this adds
// no new message and no switch: the same message, with the officers' own text and the onboarding buttons untouched, gets a card picture with
// the member's avatar and role. A welcome whose card cannot be drawn goes out exactly as before.

/** The steps shown are the ones the welcome message really has a button for (onboardingButtons): rules only with a rules channel, games only with game roles. */
export interface WelcomeSteps { rules: boolean; games: boolean }

export function welcomeCard(lang: Lang, input: { name: string; guildName: string; memberCount: number }, steps: WelcomeSteps = { rules: true, games: true }): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const guildName = [...input.guildName].length > 28 ? `${[...input.guildName].slice(0, 27).join("")}…` : input.guildName;
  const list: { name: string; sub: string }[] = [];
  if (steps.rules) list.push({ name: t("Read and accept the rules", "Lis et accepte les règles"), sub: t("Use the Rules button on the welcome message", "Utilise le bouton des règles du message de bienvenue") });
  if (steps.games) list.push({ name: t("Pick your games", "Choisis tes jeux"), sub: t("So you see the right channels", "Pour voir les bons salons") });
  list.push({ name: t("Link your character", "Lie ton personnage"), sub: t("/character pair shows how, in a few steps", "/character pair explique comment, en quelques étapes") });
  return {
    eyebrow: t("Guilded · Welcome", "Guilded · Bienvenue"), title: input.name,
    subtitle: t(`Welcome to ${guildName}!`, `Bienvenue dans ${guildName} !`),
    backdrop: { kind: "board", key: "member-welcome", fallbackKey: "activity" },
    stats: [{ label: t("Members", "Membres"), value: input.memberCount.toLocaleString(fr ? "fr-CA" : "en-CA"), accent: "gold", note: t("You are one of us now", "Tu fais partie de la gang") }],
    rowsLabel: t("Start here", "Pour commencer"),
    rows: list.map((row, index) => ({ ...row, name: `${index + 1}. ${row.name}` })),
    footer: t("Welcome · The server's own welcome message and buttons come with this card · guildedwow.com", "Bienvenue · Le message et les boutons du serveur accompagnent cette carte · guildedwow.com")
  };
}

/** The welcome card as an attachment (with alt text), or null when it cannot be drawn. Never throws. */
export async function welcomeCardFile(discordGuild: Guild, member: GuildMember, language: string | null | undefined, steps?: WelcomeSteps): Promise<AttachmentBuilder | null> {
  return drawWelcomeCard(discordGuild, member, language, steps);
}
/** The member's avatar, name and role are best effort and never hold the welcome back for more than this. */
export const WELCOME_MEMBER_MS = 1200;

async function drawWelcomeCard(discordGuild: Guild, member: GuildMember, language: string | null | undefined, steps?: WelcomeSteps): Promise<AttachmentBuilder | null> {
  try {
    const lang: Lang = language === "fr" ? "fr" : "en";
    const base = welcomeCard(lang, { name: member.displayName || member.user.username, guildName: discordGuild.name, memberCount: discordGuild.memberCount }, steps);
    const limit = new Promise<ScoreCard>(resolve => { setTimeout(() => resolve(base), WELCOME_MEMBER_MS).unref?.(); });
    const card = await Promise.race([withDiscordMember(discordGuild, base, member.id, url => downloadImage(url, 1000)), limit]);
    const png = await scoreCardPng(card);
    return png ? cardAttachment(png, "welcome.png") : null;
  } catch { return null; }
}
