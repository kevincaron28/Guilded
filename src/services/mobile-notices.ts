import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { StoredHelpCall } from "./guild-map.js";
import { HELP_PUSH_FRESH_MS, type NoticeAlert } from "./mobile-alerts.js";

// Phone app 0.6.0: the two pushes that are not raid reminders. They are queued here into the same per-device outbox
// (MobileDelivery) as the raid alerts; runMobileAlerts sends them on its next minute tick and checks again, at send
// time, that the phone still wants them and that they still apply (call not cleared, raid still planned).

type NoticeDb = Pick<PrismaClient, "mobileDevice" | "mobileDelivery">;

/** One help push per phone at most every five minutes: a fight can produce several calls in a row. */
export const HELP_PUSH_GAP_MS = 5 * 60_000;

const noticeKey = (generation: number, identity: unknown) => createHash("sha256").update(JSON.stringify([generation, identity])).digest("hex");

/**
 * A guildmate called for help in game: every other member of the guild with push and help calls on gets one push.
 * Calls that reached the bot late (older than HELP_PUSH_FRESH_MS) are not pushed. Never throws to the uploader.
 */
export async function queueHelpCallPush(database: NoticeDb, call: StoredHelpCall, now = new Date()): Promise<number> {
  if (now.getTime() - call.calledAt.getTime() > HELP_PUSH_FRESH_MS) return 0;
  const devices = await database.mobileDevice.findMany({
    where: { enabled: true, helpCalls: true, expoPushToken: { not: null }, credential: { revokedAt: null, member: { guildId: call.guildId, status: "ACTIVE", id: { not: call.memberId } } } },
    select: { id: true, generation: true }, take: 500
  });
  const notice: NoticeAlert = { kind: "help", helpCallId: call.id, character: call.character.slice(0, 60), zone: (call.zone || "?").slice(0, 60), at: call.calledAt.toISOString() };
  let queued = 0;
  for (const device of devices) {
    const recent = await database.mobileDelivery.count({ where: { deviceId: device.id, createdAt: { gt: new Date(now.getTime() - HELP_PUSH_GAP_MS) }, payload: { path: ["kind"], equals: "help" } } });
    if (recent) continue;
    await database.mobileDelivery.upsert({
      where: { deviceId_eventKey: { deviceId: device.id, eventKey: noticeKey(device.generation, { kind: "help", id: call.id }) } },
      create: { deviceId: device.id, eventKey: noticeKey(device.generation, { kind: "help", id: call.id }), generation: device.generation,
        expiresAt: new Date(call.calledAt.getTime() + HELP_PUSH_FRESH_MS), payload: notice as unknown as Prisma.InputJsonValue },
      update: {}
    });
    queued++;
  }
  return queued;
}

/** A waitlisted member was moved into the raid (someone left, a cap changed): their phones get one push. */
export async function queueRaidSpotPush(database: NoticeDb, spot: { guildId: string; discordUserId: string; raidId: string; role: string; title: string; scheduledAt: Date }, now = new Date()): Promise<number> {
  if (spot.scheduledAt <= now) return 0;
  const devices = await database.mobileDevice.findMany({
    where: { enabled: true, raidSpots: true, expoPushToken: { not: null }, credential: { revokedAt: null, member: { guildId: spot.guildId, discordUserId: spot.discordUserId, status: "ACTIVE" } } },
    select: { id: true, generation: true }, take: 10
  });
  const notice: NoticeAlert = { kind: "spot", raidId: spot.raidId, role: spot.role, state: { title: spot.title.slice(0, 30), at: spot.scheduledAt.toISOString() } };
  for (const device of devices) {
    // Moved in, out and in again: each promotion is a new event, so the key carries the minute.
    const key = noticeKey(device.generation, { kind: "spot", raidId: spot.raidId, minute: Math.floor(now.getTime() / 60_000) });
    await database.mobileDelivery.upsert({
      where: { deviceId_eventKey: { deviceId: device.id, eventKey: key } },
      create: { deviceId: device.id, eventKey: key, generation: device.generation, expiresAt: spot.scheduledAt, payload: notice as unknown as Prisma.InputJsonValue },
      update: {}
    });
  }
  return devices.length;
}
