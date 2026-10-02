import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { ZodError } from "zod";
import { allowManageWrite, coreOwnValues, createCompanionManage, ManageError, resetManageWrites, type ManageAccess } from "../src/services/companion-manage.js";

const db = vi.hoisted(() => ({
  guild: { findUnique: vi.fn() },
  guildSettings: { findUnique: vi.fn() },
  member: { findFirst: vi.fn(), findMany: vi.fn() },
  character: { findFirst: vi.fn(), findMany: vi.fn() },
  companionCredential: { findFirst: vi.fn(), updateMany: vi.fn() },
  raidCore: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  coreItemValue: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  wishlistEntry: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  lootAward: { findMany: vi.fn() },
  auditLog: { create: vi.fn() }
}));
const syncCoreRoster = vi.hoisted(() => vi.fn());
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));
vi.mock("../src/services/raid-core.js", async (original) => ({ ...await original<typeof import("../src/services/raid-core.js")>(), syncCoreRoster }));

const member: ManageAccess = { memberId: "me", actorId: "discord-me", officer: false, raidLeader: false };
const leader: ManageAccess = { ...member, raidLeader: true };
const coreRow = { id: "core", guildId: "guild", name: "Tuesday", description: null, realm: null, attendanceEp: null, lateEp: null, bossEp: 5, completionEp: null, baseGp: null, decayPercent: 0.1, lootMode: null, reservesPerPlayer: null, offspecPercent: null, minEp: null };
const manage = createCompanionManage(db as never);

beforeEach(() => {
  vi.clearAllMocks(); resetManageWrites();
  db.guildSettings.findUnique.mockResolvedValue({ coreLootOnly: false });
  db.raidCore.findFirst.mockImplementation(async ({ where }) => where.id === "core" && where.guildId === "guild" ? coreRow : null);
  db.raidCore.update.mockResolvedValue(coreRow);
  db.character.findFirst.mockImplementation(async ({ where }) => where.id === "mine" && where.memberId === "me" ? { id: "mine", name: "Thrall" } : null);
  db.wishlistEntry.upsert.mockImplementation(async ({ create }) => create);
  db.coreItemValue.upsert.mockResolvedValue({});
  db.member.findFirst.mockResolvedValue(null);
});

describe("companion editing permissions", () => {
  it("lets a member edit only their own characters' wishlists", async () => {
    await expect(manage.apply("guild", member, { action: "wishlist.set", characterId: "mine", item: "Sulfuras", priority: 1 })).resolves.toMatchObject({ message: expect.stringContaining("Thrall") });
    expect(db.wishlistEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ characterId: "mine", itemName: "Sulfuras", priority: 1 }) }));
    await expect(manage.apply("guild", member, { action: "wishlist.set", characterId: "someone-else", item: "Sulfuras", priority: 1 })).rejects.toMatchObject({ status: 403 });
    expect(db.wishlistEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it("refuses prices, rules and rosters to members who are not Raid Leaders", async () => {
    for (const change of [
      { action: "prices.set", coreId: null, text: "Sulfuras = 250" },
      { action: "core.update", coreId: "core", base: {}, changes: { bossEp: 10 } },
      { action: "core.member.remove", coreId: "core", memberId: "x" }
    ]) await expect(manage.apply("guild", member, change)).rejects.toMatchObject({ status: 403 });
    expect(db.coreItemValue.upsert).not.toHaveBeenCalled();
    expect(db.raidCore.update).not.toHaveBeenCalled();
  });

  it("never touches another guild's core or a player outside the guild", async () => {
    await expect(manage.apply("other-guild", leader, { action: "prices.set", coreId: "core", text: "Sulfuras = 250" })).rejects.toMatchObject({ status: 404 });
    await expect(manage.apply("guild", leader, { action: "core.member.set", coreId: "core", memberId: "stranger", role: "DPS", bench: false })).rejects.toMatchObject({ status: 404 });
    expect(db.member.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "stranger", guildId: "guild", status: "ACTIVE" } }));
  });

  it("rejects fields the companion may not set, such as the point pool", async () => {
    await expect(manage.apply("guild", leader, { action: "core.update", coreId: "core", base: {}, changes: { separatePool: true } })).rejects.toBeInstanceOf(ZodError);
    await expect(manage.apply("guild", leader, { action: "core.update", coreId: "core", base: {}, changes: { decayPercent: 150 } })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("companion core and price edits", () => {
  it("saves prices for a core and reports skipped lines", async () => {
    const result = await manage.apply("guild", leader, { action: "prices.set", coreId: "core", text: "Sulfuras = 250\nnonsense" });
    expect(db.coreItemValue.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ coreId: "core", itemName: "Sulfuras", gp: 250 }) }));
    expect(result.message).toContain("1 line(s) skipped");
    expect(result.audit).toMatchObject({ coreId: "core", prices: 1 });
  });

  it("stores decay as a fraction, clears to the guild default with null, and refreshes the roster", async () => {
    const result = await manage.apply("guild", leader, { action: "core.update", coreId: "core", base: coreOwnValues(coreRow), changes: { decayPercent: 25, bossEp: null, description: "  Tuesdays  " } });
    expect(db.raidCore.update).toHaveBeenCalledWith({ where: { id: "core" }, data: { decayPercent: 0.25, bossEp: null, description: "Tuesdays" } });
    expect(result.rosterCoreId).toBe("core");
  });

  it("refuses an edit made over a value someone else changed meanwhile", async () => {
    const base = { ...coreOwnValues(coreRow), bossEp: 3 };
    await expect(manage.apply("guild", leader, { action: "core.update", coreId: "core", base, changes: { bossEp: 10 } })).rejects.toMatchObject({ status: 409 });
    // A value the edit does not touch may differ.
    await expect(manage.apply("guild", leader, { action: "core.update", coreId: "core", base, changes: { lateEp: 2 } })).resolves.toBeTruthy();
  });

  it("keeps a loot system on every core when each core has its own loot", async () => {
    db.guildSettings.findUnique.mockResolvedValue({ coreLootOnly: true });
    await expect(manage.apply("guild", leader, { action: "core.update", coreId: "core", base: coreOwnValues(coreRow), changes: { lootMode: null } })).rejects.toBeInstanceOf(ManageError);
  });

  it("limits how many changes one member can send in a short time", () => {
    for (let i = 0; i < 120; i++) expect(allowManageWrite("m", 1_000)).toBe(true);
    expect(allowManageWrite("m", 1_000)).toBe(false);
    expect(allowManageWrite("other", 1_000)).toBe(true);
    expect(allowManageWrite("m", 1_000 + 5 * 60_000)).toBe(true);
  });
});

describe("companion editing over HTTP", async () => {
  const { startCompanionApi, resetFailures } = await import("../src/companion-api.js");
  const { hashCompanionSecret } = await import("../src/services/character-pairing.js");
  const secret = "x".repeat(43);
  let isLeader = false;
  const fetchMember = vi.fn(async () => ({ id: "discord-me", permissions: { has: () => false }, roles: { cache: { some: (match: (role: { name: string }) => boolean) => isLeader && match({ name: "Raid Leader" }) } } }));
  const client = { isReady: () => true, guilds: { fetch: vi.fn(async () => ({ members: { fetch: fetchMember } })) } };
  let server: ReturnType<typeof startCompanionApi>;
  let address: string;
  beforeAll(async () => {
    server = startCompanionApi(client as never);
    await once(server, "listening");
    const bound = server.address();
    if (!bound || typeof bound === "string") throw new Error("Test server address unavailable");
    address = `http://127.0.0.1:${bound.port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => {
    resetFailures(); isLeader = false;
    db.guild.findUnique.mockImplementation(async ({ where }) => ({ id: "guild", discordId: where.discordId }));
    db.companionCredential.findFirst.mockImplementation(async ({ where }) => where.tokenHash === hashCompanionSecret(secret) ? { memberId: "me", member: { discordUserId: "discord-me" } } : null);
  });
  const send = (change: unknown, credential = secret) => fetch(`${address}/api/v1/manage`, { method: "POST", headers: { "content-type": "application/json", "x-companion-credential": credential }, body: JSON.stringify({ guildDiscordId: "123", change }) });

  it("requires a paired companion", async () => {
    expect((await fetch(`${address}/api/v1/manage?guild=123`)).status).toBe(401);
    expect((await send({ action: "prices.set", coreId: null, text: "A = 1" }, "y".repeat(43))).status).toBe(401);
  });

  it("checks the member's Discord roles on every change", async () => {
    const refused = await send({ action: "core.update", coreId: "core", base: coreOwnValues(coreRow), changes: { bossEp: 10 } });
    expect(refused.status).toBe(403);
    isLeader = true;
    const saved = await send({ action: "core.update", coreId: "core", base: coreOwnValues(coreRow), changes: { bossEp: 10 } });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, message: "Saved Tuesday." });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "discord-me", action: "CONFIG_UPDATED", entityId: "core", metadata: expect.objectContaining({ via: "companion" }) }) });
    expect(syncCoreRoster).toHaveBeenCalledWith(expect.anything(), db, "guild", "core");
  });

  it("answers a service's own message as a bad request and a malformed change as 400", async () => {
    isLeader = true;
    expect((await send({ action: "core.update", coreId: "core", base: {}, changes: { separatePool: true } })).status).toBe(400);
    db.wishlistEntry.deleteMany.mockResolvedValue({ count: 0 });
    const missing = await send({ action: "wishlist.remove", characterId: "mine", item: "Nothing" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("That item is not on this character's wishlist.");
  });
});
