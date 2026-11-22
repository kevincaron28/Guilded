import { isValidTimeZone, localParts, zonedTime } from "./raid-time.js";

export interface WeeklySlot { weekday: number; hour: number; minute: number }
// Signups open six days before each raid night.
export const CORE_SCHEDULE_DAYS = 6;
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const ALIASES = ["sunday sun dimanche dim", "monday mon lundi lun", "tuesday tue tues mardi mar",
  "wednesday wed mercredi mer", "thursday thu thurs jeudi jeu", "friday fri vendredi ven", "saturday sat samedi sam"];
const dayNumbers = new Map(ALIASES.flatMap((names, weekday) => names.split(" ").map(name => [name, weekday] as const)));

// Each night needs an explicit start time. A slash joins days sharing that time.
export function parseWeeklySchedule(input: string): WeeklySlot[] {
  const text = input.trim().toLowerCase();
  if (!text || /^(off|stop|arrêt|arret)$/.test(text)) return [];
  if (text.length > 400) throw new Error("Horaire trop long (400 caractères maximum).");
  const slots = new Map<string, WeeklySlot>();
  for (const line of text.split(/[;\n,]+/).map(line => line.trim()).filter(Boolean)) {
    const match = line.match(/^([a-z/ ]+?)\s+(?:à\s+|at\s+)?(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm|h)?$/);
    if (!match) throw new Error(`Horaire invalide : « ${line} ». Exemple : mardi 20h; jeudi 20h30. Heure de début seulement.`);
    let hour = Number(match[2]);
    const minute = Number(match[3] ?? 0);
    const suffix = match[4];
    if (minute > 59 || hour > 23 || ((suffix === "am" || suffix === "pm") && (hour < 1 || hour > 12)) || (!suffix && !match[3])) {
      throw new Error(`Heure invalide : « ${line} ». Utilise 20h, 20:30 ou 8pm.`);
    }
    if (suffix === "am" && hour === 12) hour = 0;
    if (suffix === "pm" && hour < 12) hour += 12;
    for (const day of match[1]!.split("/").map(day => day.trim())) {
      const weekday = dayNumbers.get(day);
      if (weekday === undefined) throw new Error(`Jour invalide : « ${day} ». Exemple : mardi 20h; jeudi 20h30.`);
      slots.set(`${weekday}:${hour}:${minute}`, { weekday, hour, minute });
    }
  }
  if (!slots.size || slots.size > 14) throw new Error("Indique de 1 à 14 départs de raid par semaine.");
  return [...slots.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute);
}

export const weeklyScheduleText = (slots: WeeklySlot[]): string => slots.map(slot =>
  `${DAYS[slot.weekday]} ${String(slot.hour).padStart(2, "0")}h${String(slot.minute).padStart(2, "0")}`).join("; ");

export function weeklyScheduleData(input: string | null | undefined, timezone: string, createdBy: string) {
  const slots = parseWeeklySchedule(input ?? "");
  if (!isValidTimeZone(timezone)) throw new Error("Fuseau horaire invalide. Vérifie le fuseau du serveur dans /setup.");
  const schedule = slots.length ? weeklyScheduleText(slots) : null;
  return { schedule, weeklySchedule: schedule, weeklyTimezone: schedule ? timezone : null, weeklyCreatedBy: schedule ? createdBy : null };
}

// Local calendar days, rather than 24-hour multiples (DST days are shorter/longer).
// Nonexistent spring-forward times are skipped. Ambiguous fall-back times occur once.
export function weeklyOccurrences(slots: WeeklySlot[], timezone: string, now = new Date(), options: { weeklyStartDate?: string | null; weeklyHorizonDays?: number } = {}) {
  if (!isValidTimeZone(timezone)) throw new Error("Invalid weekly schedule timezone.");
  const days = options.weeklyHorizonDays ?? CORE_SCHEDULE_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("Planning window must be 1–90 days.");
  let anchor = now;
  if (options.weeklyStartDate) {
    const [y, m, d] = options.weeklyStartDate.split("-").map(Number);
    const start = zonedTime(y!, m!, d!, 0, 0, timezone);
    if (start > anchor) anchor = start;
  }
  const today = localParts(anchor, timezone);
  const last = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
  const until = new Date(zonedTime(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate(), today.hour, today.minute, timezone).getTime()
    + anchor.getUTCSeconds() * 1000 + anchor.getUTCMilliseconds());
  const result: { scheduledAt: Date; key: string }[] = [];
  for (let offset = 0; offset <= days; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    for (const slot of slots.filter(slot => slot.weekday === day.getUTCDay())) {
      const at = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), slot.hour, slot.minute, timezone);
      const shown = localParts(at, timezone);
      if (shown.year !== day.getUTCFullYear() || shown.month !== day.getUTCMonth() + 1 || shown.day !== day.getUTCDate() || shown.hour !== slot.hour || shown.minute !== slot.minute) continue;
      if (at <= now || at > until) continue;
      result.push({ scheduledAt: at, key: `${day.toISOString().slice(0, 10)}:${slot.hour}:${slot.minute}` });
    }
  }
  return result.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
