import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { resetFailures, startCompanionApi } from "../src/companion-api.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";

const db = vi.hoisted(() => ({
  companionCredential: { findFirst: vi.fn() },
  webCompanionCredential: { findFirst: vi.fn() },
  member: { findMany: vi.fn() },
  guildSettings: { findMany: vi.fn() },
  tcgMatch: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  tcgPlayer: { findUnique: vi.fn() },
  tcgDaily: { findUnique: vi.fn() },
  $transaction: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));

const secret = "c".repeat(43);
let server: ReturnType<typeof startCompanionApi>;
let base: string;
beforeAll(async () => {
  server = startCompanionApi(undefined);
  await once(server, "listening");
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("Test server address unavailable");
  base = `http://127.0.0.1:${bound.port}/api/v1/companion/clash`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  resetFailures(); vi.clearAllMocks();
  db.companionCredential.findFirst.mockImplementation(async ({ where }) => where.tokenHash === hashCompanionSecret(secret) ? { member: { discordUserId: "u1" } } : null);
  db.webCompanionCredential.findFirst.mockResolvedValue(null);
  db.member.findMany.mockResolvedValue([{ guildId: "g1", guild: { discordId: "123" } }]);
  db.guildSettings.findMany.mockResolvedValue([]);
  db.tcgMatch.findFirst.mockResolvedValue(null);
  db.tcgMatch.findMany.mockResolvedValue([]);
  db.tcgMatch.count.mockResolvedValue(0);
  db.tcgPlayer.findUnique.mockResolvedValue(null);
  db.tcgDaily.findUnique.mockResolvedValue(null);
});
const headers = (credential = secret) => ({ "content-type": "application/json", "x-companion-credential": credential });
const post = (path: string, body: unknown, credential = secret) => fetch(`${base}/${path}`, { method: "POST", headers: headers(credential), body: JSON.stringify(body) });
const get = (path: string, credential = secret) => fetch(`${base}/${path}`, { headers: headers(credential) });

describe("Guilded Clash match routes", () => {
  it("answers 401 without a valid sign-in, on every route", async () => {
    for (const [method, path] of [["GET", "matches"], ["GET", "pve"], ["GET", "match?id=x"], ["POST", "start"], ["POST", "intent"], ["POST", "concede"]] as const) {
      resetFailures();
      const none = await fetch(`${base}/${path}`, { method, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(none.status, `${method} ${path} without a credential`).toBe(401);
      resetFailures();
      const bad = await fetch(`${base}/${path}`, { method, headers: headers("z".repeat(43)), ...(method === "POST" ? { body: "{}" } : {}) });
      expect(bad.status, `${method} ${path} with a stale credential`).toBe(401);
    }
    expect(db.tcgMatch.findMany).not.toHaveBeenCalled();
  });

  it("answers 403 when the officer switch is off for every server the member is in", async () => {
    db.guildSettings.findMany.mockResolvedValue([{ guildId: "g1" }]);
    for (const [method, path] of [["GET", "matches"], ["GET", "pve"], ["GET", "match?id=x"], ["POST", "start"]] as const) {
      const res = await fetch(`${base}/${path}`, { method, headers: headers(), ...(method === "POST" ? { body: JSON.stringify({ mode: "ai", cls: "mage" }) } : {}) });
      expect(res.status, path).toBe(403);
    }
    expect(db.tcgMatch.create).not.toHaveBeenCalled();
  });

  it("answers 403 for a member in no served server", async () => {
    db.member.findMany.mockResolvedValue([]);
    expect((await get("matches")).status).toBe(403);
  });

  it("answers 404 for a missing or foreign match and for an unknown boss", async () => {
    expect((await get("match?id=nope")).status).toBe(404);
    expect((await post("intent", { id: "nope", action: { t: "end" } })).status).toBe(404);
    expect((await post("concede", { id: "nope" })).status).toBe(404);
    expect((await post("start", { mode: "pve", cls: "mage", boss: "boss-99" })).status).toBe(404);
    expect(db.tcgMatch.findFirst).toHaveBeenCalledWith({ where: { id: "nope", discordUserId: "u1" } });
  });

  it("answers 400 for malformed requests and 404 for unknown routes", async () => {
    expect((await get("match")).status).toBe(400);
    expect((await post("start", { mode: "duel", cls: "mage" })).status).toBe(400);
    expect((await post("start", { mode: "ai", cls: "wizard" })).status).toBe(400);
    expect((await post("start", { mode: "ai", cls: "mage", level: "brutal" })).status).toBe(400);
    expect((await post("start", { mode: "pve", cls: "mage" })).status).toBe(400);
    expect((await post("intent", { id: "m1", action: { t: "concede", p: 0 } })).status).toBe(400);
    expect((await post("intent", { action: { t: "end" } })).status).toBe(400);
    expect((await fetch(`${base}/unknown`, { headers: headers() })).status).toBe(404);
  });

  it("lists matches and the gauntlet for a signed-in member", async () => {
    const list = await get("matches");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ matches: [] });
    const pve = await get("pve?lang=fr");
    expect(pve.status).toBe(200);
    const body = await pve.json() as { bosses: unknown[]; daily: { quests: { text: string }[] } };
    expect(body.bosses).toHaveLength(5);
    expect(body.daily.quests).toHaveLength(3);
  });
});
