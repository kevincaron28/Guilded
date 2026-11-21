import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { currentEdition } from "./edition-context.js";
import { SEASON2_DATE, SEASON2_NAME } from "./dungeon-season2.js";
import { zonedTime } from "./raid-time.js";

// Owner reminder (owner decision, 16 November 2026): everything seasonal changes season together at the official Season 2 start, and that
// only happens once the owner has scheduled it (`/guilded-season season2-review`, then `season2-activate`). From 7 days before the planned
// date (and on and after it, as an overdue notice) the bot warns in the log and sends the bot owner ONE direct message a day until a
// season after the current one is scheduled. Never a message to a member or a guild channel.

export const REMINDER_DAYS = 7;
export const REMINDER_PREFIX = "📅 Season 2 reminder";

/** The planned start of Season 2 as an instant (9 December 2026, 15:00 Pacific). */
export const plannedSeason2Start = (): Date => {
  const [year, month, day] = SEASON2_DATE.date.split("-").map(Number) as [number, number, number];
  return zonedTime(year, month, day, SEASON2_DATE.hour, 0, SEASON2_DATE.timeZone);
};

/** Pure: should the reminder be sent now? Only while no later season is scheduled or running, from 7 days before the planned start on. */
export function reminderDue(now: Date, planned: Date, scheduled: boolean, alreadyStarted: boolean): boolean {
  if (scheduled || alreadyStarted) return false;
  return planned.getTime() - now.getTime() <= REMINDER_DAYS * 86_400_000;
}

export function reminderText(now: Date, planned: Date): string {
  const days = Math.ceil((planned.getTime() - now.getTime()) / 86_400_000);
  const when = `<t:${Math.floor(planned.getTime() / 1000)}:F>`;
  const state = planned <= now ? `The planned start (${when}) has passed.` : days <= 0 ? `${SEASON2_NAME} is planned for today (${when}).` : `${SEASON2_NAME} is planned in ${days} day${days === 1 ? "" : "s"} (${when}).`;
  return `${REMINDER_PREFIX}\n${state} It is not scheduled yet, so duels, battlegrounds, Clash, raid attendance and dungeons will not change season together. Run \`/guilded-season season2-review\`, then \`/guilded-season season2-activate\`. This reminder repeats once a day until it is scheduled.`;
}

let lastDay = "", loggedDay = "";
export const resetSeason2ReminderDay = () => { lastDay = ""; loggedDay = ""; };

/**
 * One tick (the rotation tick calls it every few minutes; it sends at most once a day). `ownerId` is how the bot finds its owner.
 * Returns true when a message was sent. Never throws: a failed DM is tried again on the next tick.
 */
export async function remindSeason2(client: Client | null, db: Pick<PrismaClient, "officialSeason">, ownerId: (client: Client) => Promise<string | null>, now = new Date(),
  log: (message: string) => void = message => console.warn(message)): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  if (lastDay === day) return false;
  try {
    const planned = plannedSeason2Start();
    if (planned.getTime() - now.getTime() > REMINDER_DAYS * 86_400_000) return false;
    const edition = currentEdition();
    const [next, later] = await Promise.all([
      db.officialSeason.findFirst({ where: { gameEdition: edition, startsAt: { gt: now } }, select: { number: true } }),
      db.officialSeason.findFirst({ where: { gameEdition: edition, number: { gte: 2 }, startsAt: { lte: now } }, select: { number: true } })
    ]);
    if (!reminderDue(now, planned, Boolean(next), Boolean(later))) { lastDay = day; return false; }
    if (loggedDay !== day) log(`Season 2 is planned for ${planned.toISOString()} and is not scheduled: run /guilded-season season2-review then season2-activate.`);
    loggedDay = day;
    if (!client) { lastDay = day; return false; }
    const id = await ownerId(client);
    if (!id) return false;
    const user = await client.users.fetch(id);
    const dm = await user.createDM();
    // A restart the same day must not send it twice: look for the bot's own reminder from today.
    const startOfDay = Date.parse(`${day}T00:00:00Z`);
    const recent = await dm.messages.fetch({ limit: 15 }).catch(() => null);
    if (recent?.some(message => message.author.id === client.user?.id && message.createdTimestamp >= startOfDay && message.content.startsWith(REMINDER_PREFIX))) { lastDay = day; return false; }
    await dm.send({ content: reminderText(now, planned), allowedMentions: { parse: [] } });
    lastDay = day;
    return true;
  } catch (error) {
    // A closed DM (or any failure) is not retried every tick all day: one try and one log line per day.
    lastDay = day;
    console.error("Season 2 reminder failed", error);
    return false;
  }
}
