import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { startCompanionApi, resetFailures } from "../src/companion-api.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";

const db = vi.hoisted(() => ({
  guild: { findUnique: vi.fn() },
  guildSettings: { findUnique: vi.fn() },
  member: { findFirst: vi.fn() },
  companionCredential: { findFirst: vi.fn(), updateMany: vi.fn() },
  poeMapVisit: { createMany: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));

const secret = "x".repeat(43);
const fetchMember = vi.fn();
const client = { guilds: { fetch: vi.fn(async () => ({ members: { fetch: fetchMember } })) } };
let server: ReturnType<typeof startCompanionApi>;
let address: string;
const visit = { runRef: "a".repeat(64), character: "Ann", league: "Pilot", mode: "STANDARD", areaId: "MapSteppe", areaLevel: 80, startedAt: "2026-01-01T12:00:00Z", endedAt: "2026-01-01T12:05:00Z", endReason: "AREA_CHANGED" };
beforeAll(async () => {
  server = startCompanionApi(client as never);
  await once(server, "listening");
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("Test server address unavailable");
  address = `http://127.0.0.1:${bound.port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  resetFailures(); vi.clearAllMocks();
  db.guild.findUnique.mockImplementation(async ({ where }) => ({ id: where.discordId === "123" ? "guild" : "other", discordId: where.discordId }));
  db.companionCredential.findFirst.mockImplementation(async ({ where }) => where.member.guildId === "guild" && where.tokenHash === hashCompanionSecret(secret) ? { memberId: "owner", member: { discordUserId: "discord-owner" } } : null);
  fetchMember.mockResolvedValue({ id: "discord-owner", permissions: { has: () => true }, roles: { cache: { some: () => false } } });
  db.guildSettings.findUnique.mockResolvedValue({ poeTrackingEnabled: true, dataResetAt: null });
  db.member.findFirst.mockResolvedValue({ id: "owner" });
  db.poeMapVisit.createMany.mockResolvedValue({ count: 1 });
  db.poeMapVisit.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async run => run(db));
});
const post = (payload: unknown, credential = secret) => fetch(`${address}/api/v1/poe/visits`, { method: "POST", headers: { "content-type": "application/json", "x-companion-credential": credential }, body: JSON.stringify(payload) });

describe("PoE2 HTTP authentication and personal scope", () => {
  it("serves only public companion files with browser security headers", async () => {
    const response = await fetch(`${address}/companion/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("Your guild. In sync.");
    for (const file of ["preload.cjs", "../.env.local", "config.json", "..%2F..%2F.env.local"]) {
      expect((await fetch(`${address}/companion/${file}`)).status).toBe(404);
    }
    expect(db.companionCredential.findFirst).not.toHaveBeenCalled();
  });
  it("keeps map history scoped to the paired member, including officers", async () => {
    db.poeMapVisit.findMany.mockResolvedValue([{ ...visit, durationSeconds: 300, memberId: "owner", guildId: "guild" }]);
    const response = await fetch(`${address}/api/v1/poe/visits?guild=123&memberId=other`, { headers: { "x-companion-credential": secret } });
    expect(response.status).toBe(200);
    expect(db.poeMapVisit.findMany).toHaveBeenCalledWith({ where: { guildId: "guild", memberId: "owner" }, orderBy: { startedAt: "desc" }, take: 15 });
    const body = await response.json(); expect(body.visits[0]).not.toHaveProperty("memberId"); expect(body.visits[0]).not.toHaveProperty("runRef");
    expect((await fetch(`${address}/api/v1/poe/visits?guild=123`)).status).toBe(401);
  });
  it("disconnects only the presented personal credential", async () => {
    const response = await fetch(`${address}/api/v1/companion/logout`, { method: "POST", headers: { "content-type": "application/json", "x-companion-credential": secret }, body: JSON.stringify({ guildDiscordId: "123" }) });
    expect(response.status).toBe(200);
    expect(db.companionCredential.updateMany).toHaveBeenCalledWith({ where: { memberId: "owner", tokenHash: hashCompanionSecret(secret), revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
  it("reports the feature setting through the authenticated status route", async () => {
    const response = await fetch(`${address}/api/v1/poe/status?guild=123`, { headers: { "x-companion-credential": secret } });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ enabled: true });
    expect(fetchMember).toHaveBeenCalledWith({ user: "discord-owner", force: true });
  });
  it("binds even officer uploads to their own member and acknowledges visits", async () => {
    const response = await post({ guildDiscordId: "123", visits: [visit] });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ inserted: 1, acceptedRunRefs: [visit.runRef] });
    expect(db.poeMapVisit.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ guildId: "guild", memberId: "owner", durationSeconds: 300 })] }));
  });
  it("refuses shared/invalid tokens and cross-guild credentials before writes", async () => {
    expect((await post({ guildDiscordId: "123", visits: [visit] }, "legacy-token")).status).toBe(401);
    expect((await post({ guildDiscordId: "456", visits: [visit] })).status).toBe(401);
    expect(db.poeMapVisit.createMany).not.toHaveBeenCalled();
  });
  it("refuses revoked/departed memberships and disabled guilds", async () => {
    fetchMember.mockRejectedValueOnce(new Error("Member left"));
    expect((await post({ guildDiscordId: "123", visits: [visit] })).status).toBe(401);
    db.companionCredential.findFirst.mockResolvedValueOnce(null);
    expect((await post({ guildDiscordId: "123", visits: [visit] })).status).toBe(401);
    db.guildSettings.findUnique.mockResolvedValue({ poeTrackingEnabled: false });
    expect((await post({ guildDiscordId: "123", visits: [visit] })).status).toBe(403);
    expect(db.poeMapVisit.createMany).not.toHaveBeenCalled();
  });
  it("rejects forged owner and completion fields at the HTTP boundary", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await post({ guildDiscordId: "123", memberId: "other", visits: [visit] })).status).toBe(400);
      expect((await post({ guildDiscordId: "123", visits: [{ ...visit, completed: true }] })).status).toBe(400);
      expect(db.poeMapVisit.createMany).not.toHaveBeenCalled();
    } finally { quiet.mockRestore(); }
  });
});
