import type { Lang } from "../i18n.js";

/**
 * "1 duel" / "2 duels": the count with its noun in the right number, never "duel(s)". French uses the singular for 0 and 1
 * (and for 1.x), English only for exactly 1. `forms` are [singular, plural] for each language.
 */
export function plural(lang: Lang, count: number, en: readonly [string, string], fr: readonly [string, string]): string {
  const forms = lang === "fr" ? fr : en;
  const one = lang === "fr" ? Math.abs(count) < 2 : Math.abs(count) === 1;
  return `${count} ${one ? forms[0] : forms[1]}`;
}
