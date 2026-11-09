import type { Lang } from "../i18n.js";

// 8.5 track D3: "last seen" shown the same way everywhere (/craft who, the profession posts, the gallery).
// The date is Character.lastSeenAt (the guild roster's value); when a character has none, the newest recipe
// scan of that character stands in for it.

const DAY = 86_400_000;

/** The roster value first; the newest recipe scan when the roster has none. */
export function lastSeenOf(lastSeenAt: Date | null | undefined, scannedAt: Date | null | undefined): Date | null {
  return lastSeenAt ?? scannedAt ?? null;
}

/** "today", "yesterday", "2 days ago", "3 weeks ago", "4 months ago" (French equivalents); "unknown" for no date. */
export function lastSeenText(date: Date | null | undefined, lang: Lang = "en", now: Date = new Date()): string {
  const fr = lang === "fr";
  if (!date) return fr ? "inconnu" : "unknown";
  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY));
  if (days < 1) return fr ? "aujourd'hui" : "today";
  if (days === 1) return fr ? "hier" : "yesterday";
  if (days < 14) return fr ? `il y a ${days} jours` : `${days} days ago`;
  if (days < 60) { const weeks = Math.floor(days / 7); return fr ? `il y a ${weeks} semaines` : `${weeks} weeks ago`; }
  const months = Math.floor(days / 30);
  return fr ? `il y a ${months} mois` : `${months} month${months === 1 ? "" : "s"} ago`;
}

/** Newest first; unknown dates last. */
export const byLastSeen = (a: Date | null | undefined, b: Date | null | undefined): number => (b?.getTime() ?? 0) - (a?.getTime() ?? 0);
