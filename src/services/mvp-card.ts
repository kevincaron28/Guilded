import type { Lang } from "../i18n.js";
import type { ScoreCard } from "./score-card.js";

// The MVP of the week card (16 Nov 2026). The weekly honors post gives the card to the MVP: the name is the title once, the card type is the
// label, the right column is label-over-value, and the rows are the rest of the top of the week. The post's text then drops the top list and
// keeps the MVP line, the rookie line and the guild's week (see `weeklyPostCardExtra`). The member's avatar is added at delivery (`cardMember`).
// The week's dates are in the post's title, so the card does not repeat them.

export interface MvpCardInput {
  name: string; points: number;
  /** The next places on the week's board, best first (at most 4). */
  others: { name: string; points: number; place: number }[];
  /** Points ahead of the next place, when there is one. */
  lead?: number;
}

export function weeklyMvpCard(lang: Lang, input: MvpCardInput): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const n = (value: number) => value.toLocaleString(fr ? "fr-CA" : "en-CA");
  const place = (value: number) => fr ? `${value}e` : `${value}${[11, 12, 13].includes(value % 100) ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
  return {
    eyebrow: t("Guilded · MVP of the week", "Guilded · MVP de la semaine"), title: input.name, subtitle: t("Community points", "Points de communauté"),
    backdrop: { kind: "board", key: "hall-of-fame", fallbackKey: "activity" },
    stats: [
      { label: t("Points", "Points"), value: n(input.points), accent: "gold" },
      ...(input.lead !== undefined && input.lead > 0 ? [{ label: t("Lead", "Avance"), value: `+${n(input.lead)}` }] : [])
    ],
    ...(input.others.length ? {
      rowsLabel: t("Next on the board", "Ensuite au classement"),
      rows: input.others.map(other => ({ name: other.name, sub: t(`${place(other.place)} place`, `${place(other.place)} place`), right: `${n(other.points)} pts`, rightTone: "gold" as const }))
    } : {}),
    footer: t("MVP of the week · Community points · guildedwow.com", "MVP de la semaine · Points de communauté · guildedwow.com")
  };
}
