import { describe, expect, it, vi } from "vitest";
import { mySignupsFor, signUpFor } from "../src/services/mobile-raid-signup.js";
import { SignupsClosedError } from "../src/services/raid.js";

// Phone app 0.5.1: the member's own raid answers. The database and the raid service are fakes; what is checked is who may act on what.
const RAID = "r".repeat(24), OTHER = "o".repeat(24);
const GUILD = "123456789012345678";

function setup(raid: object | null = { id: RAID, status: "PLANNED", signupsCloseAt: null, signups: [] }, characters: { byCharacter?: boolean; main?: string } = {}) {
  const database = {
    member: { findFirst: vi.fn(async ({ where }: { where: { guild: { discordId: string } } }) => where.guild.discordId === GUILD ? { id: "m1", guildId: "g1" } : null) },
    guildSettings: { findUnique: vi.fn(async () => ({ characterSignups: characters.byCharacter ?? false })) },
    character: { findFirst: vi.fn(async () => characters.main ? { id: characters.main } : null) },
    raid: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => where.id === RAID ? raid : null), findMany: vi.fn(async () => [{ id: RAID, signupsCloseAt: null, signups: [{ status: "MAYBE", role: "HEALER", late: false }] }]) }
  };
  const raids = {
    signup: vi.fn(async () => ({ status: "SIGNED_UP", role: "TANK", late: false, promoted: [], bumped: null })),
    cancelSignup: vi.fn(async () => ({ cancelled: { status: "CANCELLED", role: "TANK", late: false }, promoted: [] }))
  };
  const call = (input: object, after = vi.fn(async () => undefined)) => signUpFor(database as never, raids as never, "u1", input, undefined, after);
  return { database, raids, call };
}

describe("phone raid sign-up", () => {
  it("signs up with the chosen role, honouring the deadline, and runs the follow-up", async () => {
    const { raids, call } = setup();
    const after = vi.fn(async () => undefined);
    const result = await call({ raidId: RAID, guildDiscordId: GUILD, choice: "YES", role: "TANK" }, after);
    expect(result).toMatchObject({ status: "ok", signup: { raidId: RAID, status: "SIGNED_UP", role: "TANK" } });
    expect(raids.signup).toHaveBeenCalledWith(RAID, "g1", "m1", "TANK", "AVAILABLE", undefined, true);
    expect(after).toHaveBeenCalledOnce();
  });
  it("names a character where sign-ups are per character: the signed-up one, else the main", async () => {
    const signed = setup({ id: RAID, status: "PLANNED", signupsCloseAt: null, signups: [{ status: "CANCELLED", role: "TANK", late: false, characterId: "c-alt" }] }, { byCharacter: true, main: "c-main" });
    await signed.call({ raidId: RAID, guildDiscordId: GUILD, choice: "YES" });
    expect(signed.raids.signup).toHaveBeenCalledWith(RAID, "g1", "m1", "DPS", "AVAILABLE", "c-alt", true);
    const fresh = setup(undefined, { byCharacter: true, main: "c-main" });
    await fresh.call({ raidId: RAID, guildDiscordId: GUILD, choice: "MAYBE" });
    expect(fresh.raids.signup).toHaveBeenCalledWith(RAID, "g1", "m1", "DPS", "MAYBE", "c-main", true);
    const off = setup(undefined, { main: "c-main" });
    await off.call({ raidId: RAID, guildDiscordId: GUILD, choice: "YES" });
    expect(off.raids.signup).toHaveBeenCalledWith(RAID, "g1", "m1", "DPS", "AVAILABLE", undefined, true);
  });
  it("keeps the current role on Maybe and defaults to DPS without one", async () => {
    const withRole = setup({ id: RAID, status: "PLANNED", signupsCloseAt: null, signups: [{ status: "SIGNED_UP", role: "HEALER", late: false }] });
    await withRole.call({ raidId: RAID, guildDiscordId: GUILD, choice: "MAYBE" });
    expect(withRole.raids.signup).toHaveBeenCalledWith(RAID, "g1", "m1", "HEALER", "MAYBE", undefined, true);
    const none = setup();
    await none.call({ raidId: RAID, guildDiscordId: GUILD, choice: "MAYBE" });
    expect(none.raids.signup).toHaveBeenCalledWith(RAID, "g1", "m1", "DPS", "MAYBE", undefined, true);
  });
  it("cancels on Can't come, and does nothing when there is nothing to cancel", async () => {
    const signed = setup({ id: RAID, status: "PLANNED", signupsCloseAt: null, signups: [{ status: "SIGNED_UP", role: "TANK", late: false }] });
    expect(await signed.call({ raidId: RAID, guildDiscordId: GUILD, choice: "NO" })).toMatchObject({ status: "ok", signup: { status: "CANCELLED" } });
    expect(signed.raids.cancelSignup).toHaveBeenCalledOnce();
    const nothing = setup();
    expect(await nothing.call({ raidId: RAID, guildDiscordId: GUILD, choice: "NO" })).toMatchObject({ status: "ok", signup: { status: null } });
    expect(nothing.raids.cancelSignup).not.toHaveBeenCalled();
  });
  it("refuses another server's, an unknown or a started raid the same way, and bad input", async () => {
    const { raids, call } = setup();
    expect(await call({ raidId: OTHER, guildDiscordId: GUILD, choice: "YES" })).toEqual({ status: "gone" });
    expect(await call({ raidId: RAID, guildDiscordId: "999999999", choice: "YES" })).toEqual({ status: "gone" });
    expect(await setup({ id: RAID, status: "ACTIVE", signupsCloseAt: null, signups: [] }).call({ raidId: RAID, guildDiscordId: GUILD, choice: "YES" })).toEqual({ status: "gone" });
    for (const bad of [{ raidId: "x", choice: "YES" }, { raidId: RAID, guildDiscordId: GUILD, choice: "ALL" }, { raidId: RAID, guildDiscordId: GUILD, choice: "YES", role: "BOSS" }]) {
      expect(await call(bad)).toEqual({ status: "invalid" });
    }
    expect(raids.signup).not.toHaveBeenCalled();
  });
  it("answers closed signups with the deadline, and a service refusal with its message", async () => {
    const closed = setup();
    closed.raids.signup.mockRejectedValueOnce(new SignupsClosedError(new Date("2026-12-01T00:00:00Z")));
    expect(await closed.call({ raidId: RAID, guildDiscordId: GUILD, choice: "YES" })).toEqual({ status: "closed", closesAt: "2026-12-01T00:00:00.000Z" });
    const refused = setup();
    refused.raids.signup.mockRejectedValueOnce(new Error("Wrong realm."));
    expect(await refused.call({ raidId: RAID, guildDiscordId: GUILD, choice: "YES" })).toEqual({ status: "refused", message: "Wrong realm." });
  });
  it("lists the member's own answers for one server only", async () => {
    const { database } = setup();
    expect(await mySignupsFor(database as never, "u1", GUILD)).toEqual({ raids: [{ raidId: RAID, status: "MAYBE", role: "HEALER", late: false, closesAt: null }] });
    expect(await mySignupsFor(database as never, "u1", "not-an-id")).toEqual({ raids: [] });
    expect(await mySignupsFor(database as never, "u1", "999999999")).toEqual({ raids: [] });
  });
});
