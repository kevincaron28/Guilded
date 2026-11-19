import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { resetFailures, startCompanionApi } from "../src/companion-api.js";
import { hashCompanionSecret } from "../src/services/character-pairing.js";

// Phone app 0.5.0: GET /api/v1/me/characters, POST /api/v1/me/characters/main and /unlink, GET /api/v1/me/promotion.
// Through the real companion API server; the two effects (make main, unlink) are replaced so the test sees whether they ran.
const db = vi.hoisted(() => ({
  companionCredential: { findFirst: vi.fn() },
  webCompanionCredential: { findFirst: vi.fn() },
  character: { findMany: vi.fn(), findUnique: vi.fn() },
  characterVerifyClaim: { findMany: vi.fn() },
  guildRosterEntry: { findMany: vi.fn() },
  guildSettings: { findUnique: vi.fn(), findMany: vi.fn() },
  member: { findMany: vi.fn(), findFirst: vi.fn() },
  memberVoiceHour: { aggregate: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));
const effects = vi.hoisted(() => ({ setMain: vi.fn(async () => undefined), unlink: vi.fn(async () => ({ text: "", lang: "en", undoId: "x" })) }));
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));
vi.mock("../src/services/character-main.js", () => ({ setMainCharacter: effects.setMain }));
vi.mock("../src/services/companion-link-dm.js", async (original) => ({ ...await original<object>(), unlinkNotMine: effects.unlink }));

const secret = "d".repeat(43);
const MINE = "a".repeat(24), THEIRS = "b".repeat(24), GONE = "c".repeat(24);
let server: ReturnType<typeof startCompanionApi>;
let base: string;
beforeAll(async () => {
  server = startCompanionApi(undefined);
  await once(server, "listening");
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("Test server address unavailable");
  base = `http://127.0.0.1:${bound.port}/api/v1/me`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

const character = (id: string, owner: string, extra: object = {}) => ({ id, name: "Secretname", detachedAt: null, member: { id: "m-" + owner, guildId: "g1", discordUserId: owner, status: "ACTIVE" }, ...extra });
beforeEach(() => {
  resetFailures(); vi.clearAllMocks();
  db.companionCredential.findFirst.mockImplementation(async ({ where }) => where.tokenHash === hashCompanionSecret(secret) ? { member: { discordUserId: "u1" } } : null);
  db.webCompanionCredential.findFirst.mockResolvedValue(null);
  db.character.findUnique.mockImplementation(async ({ where }) => where.id === MINE ? character(MINE, "u1") : where.id === THEIRS ? character(THEIRS, "u2") : null);
  db.character.findMany.mockResolvedValue([]);
  db.auditLog.create.mockResolvedValue({});
});
const headers = (credential = secret) => ({ "content-type": "application/json", "x-companion-credential": credential });
const post = (path: string, body: unknown, credential = secret) => fetch(`${base}/${path}`, { method: "POST", headers: headers(credential), body: JSON.stringify(body) });
const get = (path: string, credential = secret) => fetch(`${base}/${path}`, { headers: headers(credential) });

describe("phone app my characters and promotion routes", () => {
  it("answers 401 without a valid sign-in, on every route", async () => {
    for (const [method, path] of [["GET", "characters"], ["GET", "promotion"], ["POST", "characters/main"], ["POST", "characters/unlink"]] as const) {
      resetFailures();
      const none = await fetch(`${base}/${path}`, { method, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(none.status, `${method} ${path} without a credential`).toBe(401);
      resetFailures();
      const stale = await fetch(`${base}/${path}`, { method, headers: headers("z".repeat(43)), ...(method === "POST" ? { body: JSON.stringify({ character: MINE }) } : {}) });
      expect(stale.status, `${method} ${path} with a stale credential`).toBe(401);
    }
    expect(effects.setMain).not.toHaveBeenCalled();
    expect(effects.unlink).not.toHaveBeenCalled();
    expect(db.character.findUnique).not.toHaveBeenCalled();
  });

  it("makes the member's own character main, and refuses another member's or an unknown one with the same answer and no name", async () => {
    const ok = await post("characters/main", { character: MINE });
    expect(ok.status).toBe(200);
    expect(effects.setMain).toHaveBeenCalledWith(expect.anything(), "g1", "m-u1", MINE);

    effects.setMain.mockClear();
    const foreign = await post("characters/main", { character: THEIRS });
    const unknown = await post("characters/main", { character: GONE });
    const malformed = await post("characters/main", { character: "../x" });
    for (const res of [foreign, unknown, malformed]) expect(res.status).toBe(403);
    const foreignText = await foreign.text();
    expect(foreignText).toBe(await unknown.text());
    expect(foreignText).not.toContain("Secretname");
    expect(effects.setMain).not.toHaveBeenCalled();
  });

  it("unlinks only the member's own linked character", async () => {
    expect((await post("characters/unlink", { character: MINE })).status).toBe(200);
    expect(effects.unlink).toHaveBeenCalledTimes(1);
    expect(effects.unlink.mock.calls[0]).toEqual([expect.anything(), expect.anything(), "u1", MINE, "web"]);

    effects.unlink.mockClear();
    const foreign = await post("characters/unlink", { character: THEIRS });
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).not.toContain("Secretname");
    db.character.findUnique.mockResolvedValue(character(MINE, "u1", { detachedAt: new Date() }));
    expect((await post("characters/unlink", { character: MINE })).status).toBe(403);
    expect(effects.unlink).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON", async () => {
    const res = await fetch(`${base}/characters/main`, { method: "POST", headers: headers(), body: "not json" });
    expect(res.status).toBe(400);
  });

  it("lists only the signed-in member's characters", async () => {
    db.character.findMany.mockResolvedValue([{ id: MINE, memberId: "m-u1", name: "Aria", displayName: "Aria Stone", realm: "Forever", gameEdition: "forever", isMain: true, confirmedAt: null, linkEvidence: null,
      level: 42, className: "Mage", race: "Human", guildRankName: "Initiate", member: { guildId: "g1", guild: { name: "Québec Gold" } } }]);
    db.characterVerifyClaim.findMany.mockResolvedValue([]);
    db.guildRosterEntry.findMany.mockResolvedValue([]);
    const res = await get("characters");
    expect(res.status).toBe(200);
    expect(db.character.findMany.mock.calls[0]![0].where).toEqual({ member: { discordUserId: "u1", status: { not: "LEFT" } } });
    const body = await res.json() as { characters: Record<string, unknown>[] };
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0]).toMatchObject({ id: MINE, name: "Aria Stone", isMain: true, serverName: "Québec Gold", guildRank: "Initiate", level: 42 });
    expect(body.characters[0]).not.toHaveProperty("armoryName");
  });

  it("reports promotion progress per server for the signed-in member only", async () => {
    const now = new Date();
    db.member.findMany.mockResolvedValue([{ guildId: "g1", guild: { discordId: "123", name: "Québec Gold", gameEdition: "forever" } }]);
    db.guildSettings.findUnique.mockResolvedValue({ language: "en", promotionMinVoiceMinutes: 180 });
    db.member.findFirst.mockResolvedValue({ characters: [{ name: "Aria", displayName: null, level: 42, guildRankName: "Initiate", guildRankAt: now, isMain: true, rankSeen: { since: new Date(now.getTime() - 3 * 86_400_000) } }] });
    db.memberVoiceHour.aggregate.mockResolvedValue({ _sum: { seconds: 3600 } });
    const res = await get("promotion");
    expect(res.status).toBe(200);
    expect(db.member.findMany.mock.calls[0]![0].where).toMatchObject({ discordUserId: "u1" });
    const body = await res.json() as { servers: Record<string, unknown>[] };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]).toMatchObject({ serverName: "Québec Gold", state: "progress", linked: true, days: 3, minDays: 7, voiceMinutes: 60, minVoiceMinutes: 180, voiceDays: 7, ready: false });
  });
});
