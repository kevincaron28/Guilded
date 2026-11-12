import { describe, expect, it, vi } from "vitest";
import { DEVICE_LIMITS, handleDeviceUpload, networkKey, prismaInstallStore, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { prismaDeviceStore } from "../src/services/companion-devices.js";

// Device-key hardening (T7) and the renamed-guild fallback (T9): docs/plans/RUN_TRUST_2026-11-10.md.

const quebec: ServerCandidate = { guildId: "g1", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
const device: DeviceRow = { id: "d1", guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 };
const body = { guild: { name: "Quebec Gold", realm: "R" }, characters: [{ name: "Kev" }, { name: "Bob" }] };

function store(extra: Partial<DeviceStore> = {}, candidate: ServerCandidate = quebec) {
  const saved: string[][] = [];
  const s: DeviceStore = {
    async create() { return { id: "d1" }; }, async find() { return device; }, async candidates() { return [candidate]; },
    async characterKeys() { return []; }, async claim() { return false; },
    async saveUpload(_id, _data, rows) { saved.push(rows.map((row) => row.nameKey)); },
    ...extra
  };
  return { s, saved };
}

describe("T7: registration key", () => {
  it("counts IPv4 as is and an IPv6 address by its /64", () => {
    expect(networkKey("203.0.113.9")).toBe("203.0.113.9");
    expect(networkKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(networkKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(networkKey("2001:0db8:0001:0002::1"));
    expect(networkKey("2001:db8:1:2::1")).not.toBe(networkKey("2001:db8:1:3::1"));
  });
});

describe("T7: caps and expiry", () => {
  it("ignores new reported characters once the server holds its cap", async () => {
    const { s, saved } = store({ guildCharacterCount: async () => DEVICE_LIMITS.charactersPerGuild });
    await handleDeviceUpload(s, device, body, { now: new Date("2026-11-12T12:00:00Z") });
    expect(saved).toEqual([[]]);
    const open = store({ guildCharacterCount: async () => 5 });
    await handleDeviceUpload(open.s, device, body, { now: new Date("2026-11-12T12:00:00Z") });
    expect(open.saved).toEqual([["kev", "bob"]]);
  });

  it("forgets unclaimed devices idle for 90 days, at most every six hours", async () => {
    const expireIdle = vi.fn(async () => 0);
    const { s } = store({ expireIdle });
    const now = new Date("2030-01-01T12:00:00Z");
    await handleDeviceUpload(s, device, body, { now });
    await handleDeviceUpload(s, device, body, { now: new Date(now.getTime() + 60_000) });
    expect(expireIdle).toHaveBeenCalledTimes(1);
    expect((expireIdle.mock.calls[0] as unknown as [Date])[0].toISOString()).toBe(new Date(now.getTime() - 90 * 86_400_000).toISOString());
  });

  it("deletes only unclaimed idle devices in the real store", async () => {
    const deleteMany = vi.fn(async () => ({ count: 3 }));
    const real = prismaInstallStore({ companionDevice: { deleteMany } } as never);
    expect(await real.expireIdle!(new Date("2026-08-01"))).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { claimedMemberId: null, lastSeenAt: { lt: new Date("2026-08-01") } } });
  });
});

describe("T9: a guild renamed in game", () => {
  it("records the new name for the server the roster pointed to", async () => {
    const noteAlias = vi.fn(async () => undefined);
    const { s } = store({ noteAlias }, { ...quebec, rosterMatch: true, viaRoster: true });
    expect(await handleDeviceUpload(s, device, { ...body, guild: { name: "Quebec Gold Reborn", realm: "R" } }, { now: new Date() })).toMatchObject({ status: "synced", server: { discordId: "111111111" } });
    expect(noteAlias).toHaveBeenCalledWith("g1", { name: "Quebec Gold Reborn", realm: "R" }, expect.any(Date));
  });

  it("falls back to the server whose roster holds a character only when no guild name matches", async () => {
    const database = {
      wowGuild: { findMany: async () => [] }, guild: { findMany: vi.fn(async (args: { where: { scopeKey?: string } }) => args.where.scopeKey ? [] : [{ id: "g1", discordId: "111111111", officerSyncAt: new Date() }]) },
      guildRosterEntry: { findMany: async () => [{ guildId: "g1" }] }, character: { findMany: async () => [] }
    };
    const real = prismaInstallStore(database as never, () => "Quebec Gold");
    expect(await real.candidates("renamed guild", "r", ["kev"])).toEqual([expect.objectContaining({ guildId: "g1", viaRoster: true })]);
    expect(await real.candidates("renamed guild", "r", [])).toEqual([]);
  });
});

describe("T7: /me/connections lists and revokes claimed devices", () => {
  const account = { id: "account", discordUserId: "discord", username: "user", displayName: null };
  it("lists them and scopes revocation to the owner", async () => {
    const updateMany = vi.fn(async () => ({}));
    const findMany = vi.fn(async () => [{ id: "dev1", wowGuildName: "Quebec Gold", guild: { name: "Quebec Gold" }, claimedAt: new Date("2026-11-10"), createdAt: new Date("2026-11-09") }]);
    const stores = prismaDeviceStore({ companionCredential: { findMany: async () => [], updateMany: vi.fn() }, webCompanionCredential: { findMany: async () => [], updateMany: vi.fn() }, companionDevice: { findMany, updateMany } } as never);
    expect(await stores.list(account)).toEqual([expect.objectContaining({ id: "dev1", kind: "device", name: "Companion (Quebec Gold)" })]);
    await stores.change(account, "revoke", "device", "guessed", "");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "guessed", revokedAt: null, claimedMember: { discordUserId: "discord" } } }));
  });
});
