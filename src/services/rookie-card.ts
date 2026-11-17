import type { Lang } from "../i18n.js";
import { plural } from "./card-plural.js";
import type { ScoreCard } from "./score-card.js";

// The rookie of the week card (9.3). The weekly honors post already names the rookie in one embed field; when the card is drawn it
// carries that line (name, points, place on the week's board) and the field is dropped from the text, which stays as the fallback.
// No new message and no new switch: it is part of the weekly honors post. The member's avatar is added at delivery (`cardMember`).
// Layout (16 Nov 2026): the member's name is the title ONCE, the card type is the label, the right column is label-over-value and the body
// says what the place means (ahead of N members) instead of repeating the name.

export function weeklyRookieCard(lang: Lang, input: { name: string; points: number; place: number; ranked: number; week: string }): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const n = (value: number) => value.toLocaleString(fr ? "fr-CA" : "en-CA");
  const behind = Math.max(0, input.ranked - input.place);
  return {
    eyebrow: t("Guilded · Rookie of the week", "Guilded · Recrue de la semaine"), title: input.name, subtitle: t("Not the MVP: the best new member", "Pas le MVP : le meilleur nouveau membre"),
    backdrop: { kind: "board", key: "rookie-of-the-week", fallbackKey: "activity" },
    stats: [
      { label: t("Points", "Points"), value: n(input.points), accent: "gold" },
      { label: t("Place", "Rang"), value: `${input.place}/${input.ranked}` }
    ],
    rowsLabel: t("Welcome!", "Bienvenue !"),
    rows: [
      { name: behind > 0 ? t(`Ahead of ${plural(lang, behind, ["member", "members"], ["", ""])}`, `Devant ${plural(lang, behind, ["", ""], ["membre", "membres"])}`)
          : t("Among everyone who scored", "Parmi tous ceux qui ont marqué"), sub: t("A new member already on the board", "Nouveau membre déjà au classement") }
    ],
    footer: t("Weekly honors · New members only", "Honneurs de la semaine · Nouveaux membres seulement")
  };
}
