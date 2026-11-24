import { describe, expect, it, vi } from "vitest";
import { HELP_PUSH_GAP_MS, queueHelpCallPush, queueRaidSpotPush } from "../src/services/mobile-notices.js";
import { configureMobileDevice, noticeText, runMobileAlerts } from "../src/services/mobile-alerts.js";
import { hostedPilot } from "../src/hosted-pilot.js";

const now = new Date("2026-11-24T20:00:00Z");
const call = { id: "call-1", guildId: "g1", memberId: "caller", character: "Lebowski Highspirits", zone: "Duskwood", calledAt: new Date(now.getTime() - 60_000), attackers: [] };

function noticeDb(devices: { id: string; generation: number }[], recent = 0) {
  return {
    mobileDevice: { findMany: vi.fn().mockResolvedValue(devices) },
    mobileDelivery: { count: vi.fn().mockResolvedValue(recent), upsert: vi.fn().mockResolvedValue({}) }
  };
}

describe("help call pushes", () => {
  it("queues one push per other guild member's phone with help calls on, never the caller's", async () => {
    const db = noticeDb([{ id: "phone-a", generation: 2 }, { id: "phone-b", generation: 0 }]);
    expect(await queueHelpCallPush(db as never, call, now)).toBe(2);
    const where = db.mobileDevice.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ enabled: true, helpCalls: true, credential: { revokedAt: null, member: { guildId: "g1", status: "ACTIVE", id: { not: "caller" } } } });
    const created = db.mobileDelivery.upsert.mock.calls[0]![0].create;
    expect(created.payload).toEqual({ kind: "help", helpCallId: "call-1", character: "Lebowski Highspirits", zone: "Duskwood", at: call.calledAt.toISOString() });
    expect(created.generation).toBe(2);
  });
  it("skips a call that reached the bot late, and a phone that got a help push in the last five minutes", async () => {
    const late = noticeDb([{ id: "phone-a", generation: 0 }]);
    expect(await queueHelpCallPush(late as never, { ...call, calledAt: new Date(now.getTime() - 30 * 60_000) }, now)).toBe(0);
    expect(late.mobileDevice.findMany).not.toHaveBeenCalled();
    const busy = noticeDb([{ id: "phone-a", generation: 0 }], 1);
    expect(await queueHelpCallPush(busy as never, call, now)).toBe(0);
    expect(busy.mobileDelivery.count.mock.calls[0]![0].where.createdAt.gt).toEqual(new Date(now.getTime() - HELP_PUSH_GAP_MS));
    expect(busy.mobileDelivery.upsert).not.toHaveBeenCalled();
  });
});

describe("raid spot pushes", () => {
  it("queues a push for the promoted member's phones with raid spots on, until the raid starts", async () => {
    const db = noticeDb([{ id: "phone-a", generation: 1 }]);
    const spot = { guildId: "g1", discordUserId: "123", raidId: "raid-1", role: "HEALER", title: "Molten Core", scheduledAt: new Date(now.getTime() + 3_600_000) };
    expect(await queueRaidSpotPush(db as never, spot, now)).toBe(1);
    expect(db.mobileDevice.findMany.mock.calls[0]![0].where).toMatchObject({ raidSpots: true, credential: { member: { guildId: "g1", discordUserId: "123" } } });
    expect(db.mobileDelivery.upsert.mock.calls[0]![0].create).toMatchObject({ expiresAt: spot.scheduledAt, payload: { kind: "spot", raidId: "raid-1", role: "HEALER", state: { title: "Molten Core" } } });
    expect(await queueRaidSpotPush(noticeDb([]) as never, { ...spot, scheduledAt: new Date(now.getTime() - 1) }, now)).toBe(0);
  });
});

describe("notice text and preferences", () => {
  it("writes the push in the phone's language", () => {
    expect(noticeText({ kind: "help", helpCallId: "c", character: "Aelira", zone: "Duskwood", at: "" }, false)).toEqual({ title: "Call for help", body: "Aelira needs help in Duskwood." });
    expect(noticeText({ kind: "help", helpCallId: "c", character: "Aelira", zone: "Duskwood", at: "" }, true).title).toBe("Appel à l'aide");
    expect(noticeText({ kind: "spot", raidId: "r", role: "DPS", state: { title: "Molten Core", at: "" } }, true)).toEqual({ title: "Molten Core", body: "Une place s'est libérée : tu es dans le raid." });
  });
  it("stores the two switches only when the phone sends them", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "d", enabled: true });
    const tx = { mobileDevice: { updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ enabled: true, expoPushToken: "ExpoPushToken[abcdefghijk]" }), upsert }, raid: { findMany: vi.fn() } };
    const database = { companionCredential: { findFirst: vi.fn().mockResolvedValue({ id: "cred", member: { guildId: "g1" } }) }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    await configureMobileDevice(database as never, "secret", { enabled: true, expoPushToken: "ExpoPushToken[abcdefghijk]", helpCalls: false });
    expect(upsert.mock.calls[0]![0].update).toMatchObject({ helpCalls: false });
    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty("raidSpots");
    await configureMobileDevice(database as never, "secret", { enabled: true, expoPushToken: "ExpoPushToken[abcdefghijk]" });
    expect(upsert.mock.calls[1]![0].update).not.toHaveProperty("helpCalls");
  });
});

describe("sending notices", () => {
  const device = (over: Record<string, unknown> = {}) => ({ id: "phone", enabled: true, expoPushToken: "ExpoPushToken[abcdefghijk]", generation: 0, locale: "en", helpCalls: true, raidSpots: true,
    credential: { revokedAt: null, member: { guildId: "g1", discordUserId: "u1", status: "ACTIVE", guild: { discordId: "999" } } }, ...over });
  const run = async (payload: unknown, dev: ReturnType<typeof device>, extra: Record<string, unknown> = {}) => {
    const update = vi.fn().mockResolvedValue({});
    const database = {
      mobileDevice: { findFirst: vi.fn().mockResolvedValue({ id: "phone" }), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(dev) },
      mobileDelivery: { deleteMany: vi.fn(), findMany: vi.fn(async ({ where }) => where.status === "PENDING" ? [{ id: "delivery", deviceId: "phone", generation: 0, payload, attempts: 0 }] : []),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), update },
      guild: { findFirst: vi.fn().mockResolvedValue({ id: "g1", scopeKey: "default" }) },
      ...extra
    };
    const member = { permissions: { has: () => true }, roles: { cache: { has: () => true } }, guild: { channels: { fetch: vi.fn() } } };
    const client = { guilds: { fetch: vi.fn().mockResolvedValue({ members: { fetch: vi.fn().mockResolvedValue(member) } }) } };
    const send = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { status: "ok", id: "ticket" } }) });
    vi.spyOn(hostedPilot, "allows").mockReturnValue(true);
    await runMobileAlerts(database as never, client as never, now, send);
    return { send, update, database };
  };
  it("drops a help push the phone switched off, without contacting Expo", async () => {
    const { send, update } = await run({ kind: "help", helpCallId: "c", character: "A", zone: "Z", at: now.toISOString() }, device({ helpCalls: false }));
    expect(send).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: "delivery" }, data: expect.objectContaining({ status: "DROPPED" }) });
  });
  it("drops a help push whose call was cleared in game", async () => {
    const { send } = await run({ kind: "help", helpCallId: "c", character: "A", zone: "Z", at: now.toISOString() }, device(),
      { guildHelpCall: { findFirst: vi.fn().mockResolvedValue({ clearedAt: now, calledAt: now }) } });
    expect(send).not.toHaveBeenCalled();
  });
  it("sends a live help call with a help tap target on the raids channel", async () => {
    const { send } = await run({ kind: "help", helpCallId: "c", character: "Aelira", zone: "Duskwood", at: now.toISOString() }, device(),
      { guildHelpCall: { findFirst: vi.fn().mockResolvedValue({ clearedAt: null, calledAt: new Date(now.getTime() - 60_000) }) } });
    const body = JSON.parse(send.mock.calls[0]![1].body);
    expect(body).toMatchObject({ title: "Call for help", body: "Aelira needs help in Duskwood.", data: { type: "help", guildDiscordId: "999" }, channelId: "raids", ttl: 900 });
  });
});
