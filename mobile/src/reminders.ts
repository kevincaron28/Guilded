import type { RaidEvent } from "./api";

export const REMINDER_LEAD_MS = 60 * 60 * 1000;
export const MAX_REMINDERS = 20;

export interface PlannedReminder {
  id: string;
  title: string;
  startsAt: string;
  fireAt: string;
  body: string;
}

export function planReminders(raids: Pick<RaidEvent, "id" | "title" | "at" | "core">[], now = Date.now(), lang: "en" | "fr" = "en"): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  for (const raid of raids) {
    const start = Date.parse(raid.at);
    if (!Number.isFinite(start) || start <= now) continue;
    const fire = start - REMINDER_LEAD_MS;
    if (fire <= now) continue;
    const body = lang === "fr"
      ? (raid.core ? `${raid.core} commence dans 60 minutes.` : "Commence dans 60 minutes.")
      : (raid.core ? `${raid.core} starts in 60 minutes.` : "Starts in 60 minutes.");
    planned.push({
      id: raid.id,
      title: raid.title,
      startsAt: new Date(start).toISOString(),
      fireAt: new Date(fire).toISOString(),
      body
    });
    if (planned.length >= MAX_REMINDERS) break;
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

export function notificationId(raidId: string): string {
  const clean = raidId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  return `guilded-raid-${clean || "event"}`;
}
