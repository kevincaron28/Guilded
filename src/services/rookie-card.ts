import type { Lang } from "../i18n.js";
import type { ScoreCard } from "./score-card.js";

// The rookie of the week card (9.3). The weekly honors post already names the rookie in one embed field; when the card is drawn it
// carries that line (name, points, place on the week's board) and the field is dropped from the text, which stays as the fallback.
// No new message and no new switch: it is part of the weekly honors post. The member's avatar is added at delivery (`cardMember`).

export function weeklyRookieCard(lang: Lang, input: { name: string; points: number; place: number; ranked: number; week: string }): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const n = (value: number) => value.toLocaleString(fr ? "fr-CA" : "en-CA");
  return {
    eyebrow: t("Guilded · Hall of fame", "Guilded · Palmarès"), title: t("Rookie of the week", "Recrue de la semaine"), subtitle: input.name,
    backdrop: { kind: "board", key: "rookie-of-the-week", fallbackKey: "activity" },
    stats: [
      { label: t("Points", "Points"), value: n(input.points), accent: "gold" },
      { label: t("Place this week", "Rang cette semaine"), value: `${input.place}/${input.ranked}`, note: t("Among everyone who scored", "Parmi tous ceux qui ont marqué") },
      { label: t("Week of", "Semaine du"), value: input.week }
    ],
    rowsLabel: t("Welcome!", "Bienvenue !"),
    rows: [{ name: input.name, sub: t("New to the community and already on the board", "Nouveau dans la gang et déjà au classement"), right: `${n(input.points)} pts`, rightTone: "gold" }],
    footer: t("Rookie of the week · New members only · Community points · guildedwow.com", "Recrue de la semaine · Nouveaux membres seulement · Points de communauté · guildedwow.com")
  };
}
