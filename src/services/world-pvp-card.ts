import type { Lang } from "../i18n.js";
import type { ScoreCard } from "./score-card.js";
import type { WeekRecap } from "./world-pvp-extras.js";

// The weekly world PvP recap as a card (9.3). The recap already exists (on by default, /bg world-pvp turns it off, pvpRecapEnabled); the card carries
// every line of its text (top killer, defender, most calls answered, quickest all clear), so when it is drawn the message is the picture alone and
// when it cannot be drawn the text goes out as before (recapText). No points or awards.

const plain = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 40);
// The category is part of the row's name ("Top killer: Aldric"), so the picture's alt text, which reads names and right-hand values, keeps it.
const labelled = (label: string, name: string) => `${label}: ${plain(name)}`;
const duration = (seconds: number) => seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;

export function worldPvpRecapCard(recap: WeekRecap, lang: Lang): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const rows: NonNullable<ScoreCard["rows"]> = [];
  if (recap.killer) rows.push({ name: labelled(t("Top killer", "Meilleur tueur"), recap.killer.name), right: `${recap.killer.kills}`, rightTone: "red" });
  if (recap.defender) rows.push({ name: labelled(t("Defender", "Défenseur"), recap.defender.name), right: `${recap.defender.defends} ${t("defends", "défenses")}`, rightTone: "green" });
  if (recap.helper) rows.push({ name: labelled(t("Most calls answered", "Plus d'appels répondus"), recap.helper.name), right: `${recap.helper.helped}`, rightTone: "gold" });
  if (recap.quickest) rows.push({ name: labelled(t("Quickest all clear", "Alerte levée la plus rapide"), recap.quickest.character), sub: plain(recap.quickest.zone), right: duration(recap.quickest.seconds), rightTone: "gold" });
  return {
    eyebrow: `Guilded · ${t("World PvP", "JcJ en monde ouvert")}`, title: t("World PvP, last week", "JcJ en monde ouvert, semaine dernière"),
    subtitle: t(`${recap.calls} call(s) for help this week`, `${recap.calls} appel(s) à l'aide cette semaine`),
    backdrop: { kind: "board", key: "world-pvp-recap", fallbackKey: "world-pvp" },
    stats: [
      ...(recap.killer ? [{ label: t("Top kills", "Meilleur total"), value: String(recap.killer.kills), accent: "red" as const }] : []),
      { label: t("Calls for help", "Appels à l'aide"), value: String(recap.calls), accent: "gold" as const }
    ],
    rowsLabel: t("Players of the week", "Joueurs de la semaine"), rows,
    footer: t("Counted by members' Guilded addon, capped each week · No points or awards · guildedwow.com", "Comptés par l'addon Guilded des membres, plafonnés chaque semaine · Aucun point ni récompense · guildedwow.com")
  };
}
