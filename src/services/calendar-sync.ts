import type { Prisma, PrismaClient, RaidRole } from "@prisma/client";
import type { AddonCalendarEvent } from "../integrations/addon.js";
import { findCharacter } from "./character-match.js";
import { createRaidService } from "./raid.js";

// The in-game guild calendar -> Discord. The addon reads the guild's calendar events and who
// answered each one; here they fill in signups of the Discord raid at the same time.
// Discord stays the official signup list: someone who already signed up (or cancelled) on Discord is
// never changed, and a declined answer changes nothing. Events with no Discord raid are only reported.

// A Discord raid within this long of the calendar event counts as the same raid.
const MATCH_WINDOW_MS = 90 * 60 * 1000;

interface LinkedCharacter { id: string; name: string; realm: string; memberId: string }

export interface CalendarMatch {
  ref: string;
  title: string;
  raidId: string;
  raidTitle: string;
  entries: { memberId: string; name: string; availability: "AVAILABLE" | "MAYBE" }[];
  declined: number;
  unlinked: string[];
}

export interface CalendarPlan {
  matches: CalendarMatch[];
  unmatched: { title: string; startsAt: Date }[];
}

export const emptyCalendarPlan = (): CalendarPlan => ({ matches: [], unmatched: [] });

type Tx = Pick<Prisma.TransactionClient, "raid">;

// Reads only: which Discord raid each upcoming calendar event is, and who answered what.
export async function planCalendarSync(tx: Tx, guildId: string, events: AddonCalendarEvent[], characters: LinkedCharacter[], now = new Date()): Promise<CalendarPlan> {
  const plan = emptyCalendarPlan();
  for (const event of events) {
    // Only events that have not ended long ago: old answers change nothing worth changing.
    if (event.startsAt.getTime() < now.getTime() - 2 * 3_600_000) continue;
    const start = event.startsAt.getTime();
    const candidates = await tx.raid.findMany({
      where: { guildId, isTest: false, status: "PLANNED", scheduledAt: { gte: new Date(start - MATCH_WINDOW_MS), lte: new Date(start + MATCH_WINDOW_MS) } },
      select: { id: true, title: true, scheduledAt: true }
    });
    const same = (title: string) => title.trim().toLowerCase() === event.title.trim().toLowerCase();
    const raid = candidates.sort((a, b) =>
      Number(same(b.title)) - Number(same(a.title)) || Math.abs(a.scheduledAt.getTime() - start) - Math.abs(b.scheduledAt.getTime() - start))[0];
    if (!raid) { plan.unmatched.push({ title: event.title, startsAt: event.startsAt }); continue; }

    // One entry per player: the best answer of any of their characters.
    const best = new Map<string, CalendarMatch["entries"][number]>();
    const unlinked = new Set<string>();
    let declined = 0;
    for (const invite of event.invites) {
      const character = findCharacter(characters, invite.character, invite.realm);
      if (!character) { unlinked.add(invite.character); continue; }
      if (invite.status === "DECLINED") { declined++; continue; }
      const availability = invite.status === "ACCEPTED" ? "AVAILABLE" : "MAYBE";
      const existing = best.get(character.memberId);
      if (!existing || (existing.availability === "MAYBE" && availability === "AVAILABLE")) {
        best.set(character.memberId, { memberId: character.memberId, name: invite.character, availability });
      }
    }
    plan.matches.push({ ref: event.ref, title: event.title, raidId: raid.id, raidTitle: raid.title, entries: [...best.values()], declined, unlinked: [...unlinked] });
  }
  return plan;
}

export interface CalendarSummary {
  matched: number;
  signedUp: number;
  maybe: number;
  waitlisted: number;
  alreadyOnDiscord: number;
  failed: number;
  declined: number;
  unlinked: string[];
  unmatched: { title: string; startsAt: Date }[];
  changedRaidIds: string[];
}

// Applies the plan through the normal signup rules (role caps, waitlist, core priority).
export async function runCalendarPlan(database: PrismaClient, guildId: string, plan: CalendarPlan): Promise<CalendarSummary> {
  const summary: CalendarSummary = {
    matched: plan.matches.length, signedUp: 0, maybe: 0, waitlisted: 0, alreadyOnDiscord: 0, failed: 0, declined: 0,
    unlinked: [], unmatched: plan.unmatched, changedRaidIds: []
  };
  const raids = createRaidService(database);
  for (const match of plan.matches) {
    summary.declined += match.declined;
    summary.unlinked.push(...match.unlinked);
    const raid = await database.raid.findUnique({ where: { id: match.raidId }, select: { coreId: true } });
    let changed = false;
    for (const entry of match.entries) {
      const existing = await database.raidSignup.findUnique({ where: { raidId_memberId: { raidId: match.raidId, memberId: entry.memberId } } });
      // Discord wins: an existing signup, or a cancelled one, stays as it is.
      if (existing) { summary.alreadyOnDiscord++; continue; }
      const coreRole = raid?.coreId
        ? (await database.raidCoreMember.findFirst({ where: { coreId: raid.coreId, memberId: entry.memberId }, select: { role: true } }))?.role
        : undefined;
      try {
        const saved = await raids.signup(match.raidId, guildId, entry.memberId, (coreRole ?? "DPS") as RaidRole, entry.availability);
        if (saved.status === "WAITLISTED") summary.waitlisted++;
        else if (saved.status === "MAYBE") summary.maybe++;
        else summary.signedUp++;
        changed = true;
      } catch {
        summary.failed++;
      }
    }
    if (changed) summary.changedRaidIds.push(match.raidId);
  }
  summary.unlinked = [...new Set(summary.unlinked)];
  return summary;
}

export function describeCalendar(summary: CalendarSummary | null): string {
  if (!summary || (summary.matched === 0 && summary.unmatched.length === 0)) return "";
  const parts: string[] = [];
  if (summary.matched > 0) {
    parts.push(`${summary.matched} in-game event(s) matched a Discord raid: ${summary.signedUp} signed up, ${summary.maybe} maybe, ${summary.waitlisted} on the waitlist`
      + `${summary.alreadyOnDiscord ? `, ${summary.alreadyOnDiscord} already answered on Discord (unchanged)` : ""}${summary.declined ? `, ${summary.declined} declined` : ""}.`);
  }
  if (summary.unlinked.length > 0) parts.push(`Not linked to a Discord member (skipped): ${summary.unlinked.slice(0, 10).join(", ")}${summary.unlinked.length > 10 ? ", ..." : ""}.`);
  for (const event of summary.unmatched.slice(0, 5)) {
    parts.push(`In-game event "${event.title}" (<t:${Math.floor(event.startsAt.getTime() / 1000)}:f>) has no Discord raid: create one with /raid create.`);
  }
  return parts.join("\n");
}

// The upcoming Discord raids the addon can turn into in-game events.
export async function upcomingRaidsForAddon(database: Pick<PrismaClient, "raid">, guildId: string, now = new Date()) {
  const raids = await database.raid.findMany({
    where: { guildId, isTest: false, status: "PLANNED", scheduledAt: { gte: now, lte: new Date(now.getTime() + 21 * 86_400_000) } },
    orderBy: { scheduledAt: "asc" }, take: 50,
    select: { id: true, title: true, scheduledAt: true, description: true, core: { select: { name: true } } }
  });
  return raids.map((raid) => ({
    id: raid.id, title: raid.title.slice(0, 30), at: raid.scheduledAt.toISOString(),
    core: raid.core?.name ?? null, note: (raid.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200)
  }));
}
