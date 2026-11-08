import type { PrismaClient } from "../generated/prisma/client.js";
import { ONLINE_WINDOW_MS } from "./invite-notify.js";

// Who is online for a live Guilded Clash challenge (stage E follow-up).
// - onlineInApp: the member's phone app (or any Clash API client) made an authenticated request in the last few minutes. Kept in
//   memory by the one bot process that serves the API, so there is nothing to store; after a restart everybody is offline until
//   their app asks again (it polls while open).
// - onlineInGame: a roster row of one of the member's linked characters says the game saw it online recently (the same signal the
//   invite tags use), never Discord presence.

export const ONLINE_APP_MS = 3 * 60_000;
const MAX_TRACKED = 5000;
const seen = new Map<string, number>();

/** Records that this member's client just made an authenticated Clash request. */
export function markSeenInApp(userId: string, now = new Date()): void {
  seen.delete(userId);
  seen.set(userId, now.getTime());
  // Oldest first: drop stale entries once the table is large.
  if (seen.size > MAX_TRACKED) for (const [id, at] of seen) { if (seen.size <= MAX_TRACKED && now.getTime() - at <= ONLINE_APP_MS) break; seen.delete(id); }
}

export const onlineInApp = (userId: string, now = new Date()): boolean => { const at = seen.get(userId); return at !== undefined && now.getTime() - at <= ONLINE_APP_MS; };
export function forgetPresence(): void { seen.clear(); }

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Which of these members have a linked character the game's roster shows online (within 10 minutes) in the same guild. */
export async function onlineInGame(db: Pick<PrismaClient, "guildRosterEntry" | "character">, userIds: string[], now = new Date()): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(userIds)];
  if (!ids.length) return out;
  const chars = await db.character.findMany({ where: { member: { discordUserId: { in: ids }, status: "ACTIVE" } }, select: { name: true, guildId: true, member: { select: { discordUserId: true } } }, take: 1500 });
  if (!chars.length) return out;
  const roster = await db.guildRosterEntry.findMany({
    where: { guildId: { in: [...new Set(chars.map(c => c.guildId))] }, inGuild: true, lastOnlineAt: { gte: new Date(now.getTime() - ONLINE_WINDOW_MS) } },
    select: { guildId: true, name: true }, take: 3000
  });
  const online = new Set(roster.map(r => `${r.guildId}|${fold(r.name)}`));
  for (const c of chars) if (online.has(`${c.guildId}|${fold(c.name)}`)) out.add(c.member.discordUserId);
  return out;
}
