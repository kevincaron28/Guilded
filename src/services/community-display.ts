import type { Lang } from "../i18n.js";
import { localParts, zonedTime } from "./raid-time.js";

export function communityStatusLabel(status: string, lang: Lang): string {
  const labels: Record<string, [string, string]> = {
    PENDING: ["Awaiting review", "En attente de validation"], CONFIRMED: ["Confirmed", "Confirmé"],
    JOINED: ["Signed up", "Inscrit"], PRESENT: ["Attendance confirmed", "Présence confirmée"],
    MAYBE: ["Maybe", "Peut-être"], ABSENT: ["Absent", "Absent"], WAITLISTED: ["Waitlist", "Liste d’attente"],
    APPROVED: ["Approved", "Approuvé"], REJECTED: ["Rejected", "Refusé"],
    CORRECT: ["Correct answer", "Bonne réponse"], INCORRECT: ["Answer recorded", "Réponse enregistrée"],
    CANCELLED: ["Cancelled", "Annulé"], REVERSED: ["Reversed", "Annulé après révision"]
  };
  return labels[status]?.[lang === "fr" ? 1 : 0] ?? (lang === "fr" ? "Enregistré" : "Recorded");
}

export function communityKindLabel(kind: string, lang: Lang): string {
  const labels: Record<string, [string, string]> = { LOTTERY: ["Draw", "Tirage"], EVENT: ["Gaming night", "Soirée gaming"], CHALLENGE: ["Challenge", "Défi"], QUIZ: ["Quiz", "Quiz"] };
  return labels[kind]?.[lang === "fr" ? 1 : 0] ?? (lang === "fr" ? "Activité" : "Activity");
}

export function communitySeasonLabel(season: { name: string; number?: number; game?: string }, lang: Lang): string {
  const number = season.number ?? 1;
  const heading = `${lang === "fr" ? "Saison" : "Season"} ${number}`;
  const theme = season.name.replace(/^(?:season|saison)\s+\d+\s*(?:[—–-]\s*)?/i, "").trim();
  return theme ? `${heading} — ${theme}` : heading;
}

export function communityMonthName(now: Date, timezone: string, lang: Lang): string {
  const label = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { timeZone: timezone, month: "long", year: "numeric" }).format(now);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function communityDiceDay(now: Date, timezone: string) {
  const parts = localParts(now, timezone);
  const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return { day: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    reset: zonedTime(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 0, 0, timezone) };
}

export function communityActivityChannel(row: { postedChannelId?: string | null; season: { channelId: string; announcementChannelId?: string | null } }): string {
  return row.postedChannelId ?? row.season.announcementChannelId ?? row.season.channelId;
}
