import type { RaidEvent } from "./api";

export const REMINDER_LEAD_MS = 60 * 60 * 1000;
/** Reminders before each raid: a day, two hours and an hour. Longest first. */
export const REMINDER_LEADS_MS = [24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000, REMINDER_LEAD_MS] as const;
/** Raids with reminders. Three reminders each stay under the 64 scheduled notifications iOS keeps per app. */
export const MAX_REMINDERS = 20;

export interface PlannedReminder {
  /** The raid's id (several reminders share it, one per lead). */
  id: string;
  title: string;
  startsAt: string;
  fireAt: string;
  body: string;
  /** How long before the start this one fires. */
  leadMs: number;
}

const WORDS = {
  [REMINDER_LEADS_MS[0]]: { en: "24 hours", fr: "24 heures" },
  [REMINDER_LEADS_MS[1]]: { en: "2 hours", fr: "2 heures" },
  [REMINDER_LEADS_MS[2]]: { en: "60 minutes", fr: "60 minutes" }
} as const;

/**
 * One reminder per raid and lead whose moment is still ahead, soonest raid first. A raid the member answered "Can't come"
 * (`skip`) gets none. A raid already inside an hour gets none (it is listed by soonRaids instead).
 */
export function planReminders(raids: Pick<RaidEvent, "id" | "title" | "at" | "core">[], now = Date.now(), lang: "en" | "fr" = "en", skip: ReadonlySet<string> = new Set()): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  const seen = new Set<string>();
  for (const raid of [...raids].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (seen.has(raid.id) || skip.has(raid.id)) continue;
    const start = Date.parse(raid.at);
    if (!Number.isFinite(start) || start <= now) continue;
    seen.add(raid.id);
    for (const leadMs of REMINDER_LEADS_MS) {
      const fire = start - leadMs;
      if (fire <= now) continue;
      const when = WORDS[leadMs][lang];
      const body = lang === "fr"
        ? (raid.core ? `${raid.core} commence dans ${when}.` : `Commence dans ${when}.`)
        : (raid.core ? `${raid.core} starts in ${when}.` : `Starts in ${when}.`);
      planned.push({ id: raid.id, title: raid.title, startsAt: new Date(start).toISOString(), fireAt: new Date(fire).toISOString(), body, leadMs });
    }
    if (seen.size >= MAX_REMINDERS) break;
  }
  return planned;
}

/** Raids that will start before a 60-minute reminder could fire. The list shows them; nothing is scheduled. */
export function soonRaids<T extends { at: string }>(raids: T[], now = Date.now()): T[] {
  return raids.filter((raid) => {
    const start = Date.parse(raid.at);
    return Number.isFinite(start) && start > now && start - now <= REMINDER_LEAD_MS;
  });
}

export function notificationId(raidId: string, leadMs: number = REMINDER_LEAD_MS): string {
  // Encode, rather than discard, separators so distinct source IDs cannot collide. The one-hour id keeps its old form, so a reminder
  // scheduled by an earlier version is replaced and never doubled; the others end in a space and the lead, which encoding never leaves in an id.
  const base = `guilded-raid-${encodeURIComponent(raidId)}`;
  return leadMs === REMINDER_LEAD_MS ? base : `${base} ${Math.round(leadMs / 3_600_000)}h`;
}
