import type { LowItem } from "./guild-bank-member.js";
import type { ScoreCard } from "./score-card.js";

// The guild bank's weekly post as a card (24 Nov 2026, card coverage audit): the gold and what moved this week as figures, the top depositors as rows and a
// warning pill when something is below its minimum. The post keeps the per-member lines and the low-stock list as text under the picture.

const say = (lang: "en" | "fr", en: string, fr: string) => lang === "fr" ? fr : en;

export interface BankWeekCardInput {
  /** Gold now and a week ago, already formatted ("125g 40s 0c"); the change is signed text, "" when unknown. */
  goldNow: string | null; change: string; changeTone: "green" | "red" | null;
  logLines: number; openRequests: number; low: readonly LowItem[];
  /** Top depositors with their gift as text ("+50g · 12 items in"). */
  givers: { name: string; gift: string }[];
}

export function guildBankWeekCard(lang: "en" | "fr", input: BankWeekCardInput): ScoreCard {
  return {
    eyebrow: say(lang, "Guilded · Guild bank", "Guilded · Banque de guilde"), title: say(lang, "Guild bank: this week", "Banque de guilde : la semaine"),
    subtitle: input.change ? say(lang, `Gold ${input.change} since last week`, `Or ${input.change} depuis la semaine dernière`) : "",
    backdrop: { kind: "board", key: "guild-bank", fallbackKey: "community" },
    stats: [
      { label: say(lang, "Gold now", "Or actuel"), value: input.goldNow ?? "—", accent: "gold", ...(input.change ? { note: input.change } : {}) },
      { label: say(lang, "Log lines", "Lignes de journal"), value: String(input.logLines) },
      { label: say(lang, "Open requests", "Demandes ouvertes"), value: String(input.openRequests), ...(input.openRequests ? { accent: "green" as const } : {}) }
    ],
    ...(input.givers.length ? { rowsLabel: say(lang, "Top depositors", "Meilleurs donateurs"), rows: input.givers.slice(0, 3).map(giver => ({ name: giver.name, right: giver.gift, rightTone: "gold" as const })) } : {}),
    ...(input.low.length ? { badges: [{ text: say(lang, `${input.low.length} below minimum`, `${input.low.length} sous le minimum`), tone: "warn" as const }] } : {}),
    footer: say(lang, "Weekly guild bank summary · From the addon's bank log", "Résumé hebdomadaire de la banque de guilde · D'après le journal de banque de l'addon")
  };
}
