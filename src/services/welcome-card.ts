import type { AttachmentBuilder, Guild, GuildMember } from "discord.js";
import type { Lang } from "../i18n.js";
import { cardAttachment } from "./card-alt.js";
import { withDiscordMember } from "./card-member.js";
import { scoreCardPng, type ScoreCard } from "./score-card.js";

// The welcome card (9.3). The welcome message already exists and is opt-in (a welcome channel or DMs configured by the officers), so this adds
// no new message and no switch: the same message, with the officers' own text and the onboarding buttons untouched, gets a card picture with
// the member's avatar and role. A welcome whose card cannot be drawn goes out exactly as before.

export function welcomeCard(lang: Lang, input: { name: string; guildName: string; memberCount: number }): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  return {
    eyebrow: t("Guilded · Welcome", "Guilded · Bienvenue"), title: input.name,
    subtitle: t(`Welcome to ${input.guildName}!`, `Bienvenue dans ${input.guildName} !`),
    backdrop: { kind: "board", key: "member-welcome", fallbackKey: "activity" },
    stats: [{ label: t("Members", "Membres"), value: input.memberCount.toLocaleString(fr ? "fr-CA" : "en-CA"), accent: "gold", note: t("You are one of us now", "Tu fais partie de la gang") }],
    rowsLabel: t("Start here", "Pour commencer"),
    rows: [
      { name: t("1. Read and accept the rules", "1. Lis et accepte les règles"), sub: t("Use the buttons under the welcome message", "Utilise les boutons sous le message de bienvenue") },
      { name: t("2. Pick your games", "2. Choisis tes jeux"), sub: t("So you see the right channels", "Pour voir les bons salons") },
      { name: t("3. Link your character", "3. Lie ton personnage"), sub: t("/character pair shows how, in a few steps", "/character pair explique comment, en quelques étapes") }
    ],
    footer: t("Welcome · The server's own message and buttons are above · guildedwow.com", "Bienvenue · Le message et les boutons du serveur sont au-dessus · guildedwow.com")
  };
}

/** The welcome card as an attachment (with alt text), or null when it cannot be drawn. Never throws. */
export async function welcomeCardFile(discordGuild: Guild, member: GuildMember, language: string | null | undefined): Promise<AttachmentBuilder | null> {
  try {
    const lang: Lang = language === "fr" ? "fr" : "en";
    const base = welcomeCard(lang, { name: member.displayName || member.user.username, guildName: discordGuild.name, memberCount: discordGuild.memberCount });
    const card = await withDiscordMember(discordGuild, base, member.id);
    const png = await scoreCardPng(card);
    return png ? cardAttachment(png, "welcome.png") : null;
  } catch { return null; }
}
