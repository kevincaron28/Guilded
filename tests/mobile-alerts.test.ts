import { describe, expect, it, vi } from "vitest";
import { configureMobileDevice, expoHeaders, mobileRaidChanges, pollMobileReceipts, raidSnapshot, runMobileAlerts } from "../src/services/mobile-alerts.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";
import { hostedPilot } from "../src/hosted-pilot.js";

const now = new Date("2026-11-04T12:00:00Z");
const state = { title: "Raid", at: "2026-11-04T12:30:00.000Z", revision: now.toISOString() };
describe("mobile raid alerts", () => {
  it("detects moved, renamed, cancelled and due raids while excluding finished reminders", () => {
    expect(mobileRaidChanges({ moved: state, renamed: state, cancelled: state, finished: { ...state, at: "2026-11-04T10:00:00Z" } }, {
      moved: { ...state, at: "2026-11-05T12:00:00Z" }, renamed: { ...state, title: "New title" }, due: state
    }, now).map(a => [a.raidId, a.kind])).toEqual([
      ["moved", "changed"], ["renamed", "changed"], ["cancelled", "cancelled"], ["renamed", "reminder"], ["due", "reminder"]
    ]);
  });
  it("keeps revision identity while comparing only visible schedule details", () => {
    const next = { ...state, revision: "2026-11-04T12:01:00Z", at: "2026-11-05T12:00:00Z" };
    expect(mobileRaidChanges({ a: next }, { a: { ...next, revision: now.toISOString() } }, now)).toEqual([]);
    expect(raidSnapshot([{ id: "a", title: "Raid", scheduledAt: new Date(state.at), updatedAt: now }])).toEqual({ a: state });
  });
  it("rejects enrollment without an explicit boolean and a valid Expo token before writing", async () => {
    const database = { companionCredential: { findUniqueOrThrow: vi.fn() } };
    await expect(configureMobileDevice(database as never, "secret", { enabled: true, expoPushToken: "https://attacker.example" })).rejects.toThrow();
    await expect(configureMobileDevice(database as never, "secret", { expoPushToken: "ExpoPushToken[abcdefghijk]" })).rejects.toThrow();
    expect(database.companionCredential.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it.each([
    { enabled: false },
    { enabled: true, expoPushToken: "ExpoPushToken[abcdefghijk]", credential: { revokedAt: now, member: { status: "ACTIVE" } } },
    { enabled: true, expoPushToken: "ExpoPushToken[abcdefghijk]", credential: { revokedAt: null, member: { status: "LEFT" } } }
  ])("drops queued alerts for disabled, revoked or inactive devices without contacting Expo (%j)", async device => {
    const update = vi.fn().mockResolvedValue({});
    const database = {
      mobileDevice: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(device) },
      mobileDelivery: { deleteMany: vi.fn(), findMany: vi.fn(async ({ where }) => where.status === "PENDING" ? [{ id: "delivery", deviceId: "phone", payload: { raidId: "r", kind: "reminder", state }, attempts: 0 }] : []), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update }
    };
    const send = vi.fn();
    await runMobileAlerts(database as never, {} as never, now, send);
    expect(send).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: "delivery" }, data: { status: "DROPPED", payload: {}, tokenHash: null, receiptId: null, receiptCheckAt: null } });
  });
  it("does not deliver a job already leased by another scheduler", async () => {
    const database = {
      mobileDevice: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
      mobileDelivery: { deleteMany: vi.fn(), findMany: vi.fn(async ({ where }) => where.status === "PENDING" ? [{ id: "delivery" }] : []), updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
    };
    const send = vi.fn();
    await runMobileAlerts(database as never, {} as never, now, send);
    expect(database.mobileDevice.findUnique).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("fans out once with scoped routing and retires invalid Expo tokens", async () => {
    const policy = vi.spyOn(hostedPilot, "allows").mockReturnValue(true);
    const raid = { id: "r", title: state.title, scheduledAt: new Date(state.at), updatedAt: now, signupChannelId: "private", status: "PLANNED" };
    const credential = { revokedAt: null, member: { guildId: "g", discordUserId: "u", status: "ACTIVE", guild: { discordId: "discord" } } };
    const device = { id: "phone", enabled: true, generation: 1, expoPushToken: "ExpoPushToken[abcdefghijk]", locale: "en", snapshot: {}, credential };
    const jobs: { id: string; deviceId: string; payload: unknown; attempts: number; status: string; eventKey: string }[] = [];
    const deviceUpdate = vi.fn().mockResolvedValue({});
    const database = {
      guild: { findFirst: vi.fn().mockResolvedValue({ id: "g", scopeKey: "default" }) },
      raid: { findMany: vi.fn().mockResolvedValue([raid]), findFirst: vi.fn().mockResolvedValue(raid) },
      mobileDevice: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([device]), findUnique: vi.fn().mockResolvedValue(device), update: deviceUpdate, updateMany: deviceUpdate },
      mobileDelivery: {
        deleteMany: vi.fn(), upsert: vi.fn(async ({ create }) => { if (!jobs.some(j => j.eventKey === create.eventKey)) jobs.push({ id: "job", attempts: 0, status: "PENDING", ...create }); }),
        findMany: vi.fn(async ({ where }) => where.status === "PENDING" ? jobs.filter(j => j.status === "PENDING") : []), updateMany: vi.fn(async ({ where, data }) => { if (where.id) Object.assign(jobs.find(j => j.id === where.id)!, data); return { count: 1 }; }),
        update: vi.fn(async ({ where, data }) => { Object.assign(jobs.find(j => j.id === where.id)!, data); })
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(database)
    };
    const member = { guild: { channels: { fetch: vi.fn().mockResolvedValue({ permissionsFor: () => ({ has: () => true }) }) } } };
    const client = { rest: { get: vi.fn().mockResolvedValue([]) }, guilds: { fetch: vi.fn().mockResolvedValue({ members: { fetch: vi.fn().mockResolvedValue(member) } }) } };
    const send = vi.fn().mockResolvedValue(Response.json({ data: { status: "ok", id: "ticket" } }));
    await runMobileAlerts(database as never, client as never, now, send);
    raid.updatedAt = new Date(now.getTime() + 1000); // unrelated metadata must not resend the reminder
    await runMobileAlerts(database as never, client as never, now, send);
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0]![1].body).data).toEqual({ type: "raid", guildDiscordId: "discord", raidId: "r", kind: "reminder" });
    jobs[0]!.status = "PENDING";
    send.mockResolvedValue(Response.json({ data: { status: "error", details: { error: "DeviceNotRegistered" } } }));
    await runMobileAlerts(database as never, client as never, now, send);
    expect(deviceUpdate).toHaveBeenCalledWith({ where: { id: "phone", generation: 1, expoPushToken: device.expoPushToken }, data: { enabled: false, expoPushToken: null, generation: { increment: 1 }, snapshot: {} } });
    policy.mockRestore();
  });
  it("uses optional Expo access-token headers without exposing them in stored payloads", () => {
    expect(expoHeaders("example-test-token")).toEqual({ "content-type": "application/json", authorization: "Bearer example-test-token" });
  });
  it.each([false, true])("receipt failures cannot retire a changed token/enrollment (%s)", async changedGeneration => {
    const oldToken = "ExpoPushToken[abcdefghijk]";
    const update = vi.fn();
    const updateMany = vi.fn();
    const database = {
      mobileDevice: { findUnique: vi.fn().mockResolvedValue({ expoPushToken: changedGeneration ? oldToken : "ExpoPushToken[replacement]" }), updateMany },
      mobileDelivery: { findMany: vi.fn().mockResolvedValue([{ id: "delivery", deviceId: "phone", generation: 1, receiptId: "ticket", tokenHash: hashCompanionSecret(oldToken) }]), update, updateMany: vi.fn() }
    };
    const send = vi.fn().mockResolvedValue(Response.json({ data: { ticket: { status: "error", details: { error: "DeviceNotRegistered" } } } }));
    await pollMobileReceipts(database as never, now, send);
    if (changedGeneration) expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "phone", generation: 1, expoPushToken: oldToken } }));
    else expect(updateMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED", tokenHash: null, receiptId: null, payload: {} }) }));
  });
  it("settles successful receipts and backs off transport failures without resending", async () => {
    const update = vi.fn(), updateMany = vi.fn();
    const database = { mobileDelivery: { findMany: vi.fn().mockResolvedValue([{ id: "d", receiptId: "ticket" }]), update, updateMany } };
    const send = vi.fn().mockResolvedValue(Response.json({ data: { ticket: { status: "ok" } } }));
    await pollMobileReceipts(database as never, now, send);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", deliveredAt: now }) }));
    send.mockRejectedValue(new Error("provider body may contain secrets"));
    await pollMobileReceipts(database as never, now, send);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["d"] }, status: "ACCEPTED" }, data: { receiptCheckAt: new Date(now.getTime() + 300_000) } });
  });
  it.each([false, true])("discards queued content and advances generation on opt-out or re-enrollment (%s)", async enabled => {
    const updateMany = vi.fn(), update = vi.fn().mockResolvedValue({ enabled, generation: 3 });
    const tx = {
      mobileDevice: { findUnique: vi.fn().mockResolvedValue({ id: "phone", enabled: false }), upsert: vi.fn().mockResolvedValue({ id: "phone" }), update, updateMany: vi.fn() },
      mobileDelivery: { updateMany }, raid: { findMany: vi.fn().mockResolvedValue([]) }
    };
    const database = { companionCredential: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cred", member: { guildId: "g" } }) }, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    await configureMobileDevice(database as never, "credential", { enabled, ...(enabled ? { expoPushToken: "ExpoPushToken[abcdefghijk]" } : {}) });
    expect(updateMany).toHaveBeenCalledWith({ where: { deviceId: "phone", status: { in: ["PENDING", "ACCEPTED"] } }, data: { status: "DROPPED", payload: {}, tokenHash: null, receiptId: null, receiptCheckAt: null } });
    expect(update).toHaveBeenCalledWith({ where: { id: "phone" }, data: { generation: { increment: 1 } } });
  });
  it.each(["reminder", "changed", "cancelled", "hidden"])("checks Discord event identity and visibility when delivering %s", async kind => {
    const policy = vi.spyOn(hostedPilot, "allows").mockReturnValue(true);
    const event = { id: "123", guild_id: "discord", channel_id: "channel", status: kind === "cancelled" ? 4 : 1, scheduled_start_time: state.at, name: state.title };
    const device = { id: "phone", enabled: true, generation: 1, expoPushToken: "ExpoPushToken[abcdefghijk]", locale: "en", credential: { revokedAt: null, member: { guildId: "g", discordUserId: "u", status: "ACTIVE", guild: { discordId: "discord" } } } };
    const update = vi.fn();
    const database = {
      mobileDevice: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(device) },
      guild: { findFirst: vi.fn().mockResolvedValue({ id: "g", scopeKey: "default" }) },
      mobileDelivery: { deleteMany: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update, findMany: vi.fn(async ({ where }) => where.status === "PENDING" ? [{ id: "d", deviceId: "phone", generation: 1, attempts: 0, payload: { raidId: "discord:123", kind: kind === "hidden" ? "reminder" : kind, state } }] : []) }
    };
    const member = { guild: { channels: { fetch: vi.fn().mockResolvedValue({ permissionsFor: () => ({ has: () => kind !== "hidden" }) }) } } };
    const client = { rest: { get: vi.fn().mockResolvedValue([event]) }, guilds: { fetch: vi.fn().mockResolvedValue({ members: { fetch: vi.fn().mockResolvedValue(member) } }) } };
    const send = vi.fn().mockResolvedValue(Response.json({ data: { status: "ok", id: "ticket" } }));
    await runMobileAlerts(database as never, client as never, now, send);
    if (kind === "hidden") expect(send).not.toHaveBeenCalled();
    else {
      expect(send).toHaveBeenCalledOnce();
      expect(JSON.parse(send.mock.calls[0]![1].body).data).toMatchObject({ raidId: "discord:123", kind });
      expect(database.mobileDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d", status: "PENDING", generation: 1 }, data: expect.objectContaining({ status: "ACCEPTED", receiptId: "ticket" }) }));
    }
    policy.mockRestore();
  });
});
