import { z } from "zod";
import { fitsGroup, type AlertCandidate, type AlertGroup } from "./group-alerts.js";

const minute = z.number().int().min(0).max(1439);
export const timezone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose a valid IANA timezone.");
const interval = z.object({ start: minute, end: minute }).strict().refine(value => value.start !== value.end, "Use different start/end times.");
export const groupSubscriptionSchema = z.object({
  optedIn: z.boolean().default(false),
  timezone,
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  available: interval,
  quiet: interval.default({ start: 22 * 60, end: 8 * 60 }),
  types: z.array(z.enum(["group", "vacancy"])).min(1).max(2)
}).strict().refine(value => {
  const age = Date.parse(value.expiresAt) - Date.parse(value.createdAt);
  return age > 0 && age <= 7 * 86_400_000;
}, "Subscriptions last at most seven days.");

export type GroupSubscription = z.infer<typeof groupSubscriptionSchema>;
export const SUBSCRIPTION_COOLDOWN_MS = 6 * 3_600_000;
export const SUBSCRIPTION_ROLLING_DAY_CAP = 2;

function localClock(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const field = (key: string) => parts.find(part => part.type === key)!.value;
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(field("weekday")), minute: Number(field("hour")) * 60 + Number(field("minute")) };
}
function inside(value: number, window: { start: number; end: number }) {
  return window.start < window.end ? value >= window.start && value < window.end : value >= window.start || value < window.end;
}
export interface SubscriptionEvent {
  key: string; // Canonical event identity, unchanged when a post is edited.
  type: "group" | "vacancy";
  immediate?: boolean; // Structured open-now group, not a time inferred from its title.
  startsAt: Date;
  expiresAt: Date;
  open: boolean;
  hasVacancy: boolean;
  group: AlertGroup;
}

/** Preview only: this does not reserve a delivery or enable a sender. Integration
 * must load history for this guild/member and reserve under a transaction lock,
 * then recheck permissions/opt-out. ATTEMPTED/UNCERTAIN reservations consume budget. */
export function subscriptionPreview(input: {
  subscription: unknown; candidate: AlertCandidate; event: SubscriptionEvent; now: Date;
  canViewChannel: boolean; isMember: boolean;
  history: { eventKey: string; attemptedAt: Date }[];
}) {
  const result = (reason: string) => ({ eligible: reason === "eligible", reason, deliveryEnabled: false as const });
  const parsed = groupSubscriptionSchema.safeParse(input.subscription);
  if (!parsed.success) return result("invalid-settings");
  const settings = parsed.data, { event, now } = input;
  if (![now, event.startsAt, event.expiresAt].every(value => Number.isFinite(value.getTime()))) return result("invalid-time");
  if (!settings.optedIn) return result("off");
  if (!input.isMember || !input.canViewChannel) return result("not-visible");
  if (Date.parse(settings.createdAt) > now.getTime() || Date.parse(settings.expiresAt) <= now.getTime()) return result("expired");
  if (event.startsAt.getTime() >= Date.parse(settings.expiresAt)) return result("outside-subscription");
  if (!event.key || !event.open || !event.hasVacancy || !(event.type === "group" && event.immediate) && event.startsAt < now || event.expiresAt <= now) return result("closed");
  if (!settings.types.includes(event.type) || !fitsGroup(event.group, input.candidate)) return result("not-matched");
  const clock = localClock(event.type === "group" && event.immediate ? now : event.startsAt, settings.timezone);
  const availabilityDay = settings.available.start > settings.available.end && clock.minute < settings.available.end ? (clock.day + 6) % 7 : clock.day;
  if (!settings.weekdays.includes(availabilityDay) || !inside(clock.minute, settings.available)) return result("outside-availability");
  if (inside(localClock(now, settings.timezone).minute, settings.quiet)) return result("quiet-hours");
  if (input.history.some(row => row.eventKey === event.key)) return result("duplicate");
  if (input.history.some(row => !Number.isFinite(row.attemptedAt.getTime()) || row.attemptedAt > now)) return result("invalid-history");
  if (input.history.some(row => now.getTime() - row.attemptedAt.getTime() < SUBSCRIPTION_COOLDOWN_MS)) return result("cooldown");
  if (input.history.filter(row => now.getTime() - row.attemptedAt.getTime() < 86_400_000).length >= SUBSCRIPTION_ROLLING_DAY_CAP) return result("daily-limit");
  return result("eligible");
}
