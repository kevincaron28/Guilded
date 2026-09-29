import { describe, expect, it, vi } from "vitest";
import { companionAccess, personalSnapshot } from "../src/services/companion-access.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";

describe("companion authorization", () => {
  it("scopes credential lookup, rechecks membership, and observes demotion", async () => {
    const findFirst = vi.fn().mockResolvedValue({ memberId: "m", member: { discordUserId: "u" } });
    let officer = true;
    const fetchMember = vi.fn().mockImplementation(async () => ({ id: "u", permissions: { has: () => officer }, roles: { cache: { some: () => false } } }));
    const db = { companionCredential: { findFirst } };
    const client = { guilds: { fetch: async () => ({ members: { fetch: fetchMember } }) } };
    expect((await companionAccess(db as never, client as never, "g", "discord", "x".repeat(43)))?.officer).toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ revokedAt: null, member: { guildId: "g", status: "ACTIVE" } }) }));
    expect(fetchMember).toHaveBeenCalledWith({ user: "u", force: true });
    officer = false;
    expect((await companionAccess(db as never, client as never, "g", "discord", "x".repeat(43)))?.officer).toBe(false);
    findFirst.mockResolvedValue(null);
    expect(await companionAccess(db as never, client as never, "other-guild", "discord", "x".repeat(43))).toBeNull();
  });
  it("fails closed when the member has left or Discord is unavailable", async () => {
    const db = { companionCredential: { findFirst: async () => ({ memberId: "m", member: { discordUserId: "u" } }) } };
    expect(await companionAccess(db as never, undefined, "g", "d", "x".repeat(43))).toBeNull();
    const client = { guilds: { fetch: async () => ({ members: { fetch: async () => { throw new Error("left"); } } }) } };
    expect(await companionAccess(db as never, client as never, "g", "d", "x".repeat(43))).toBeNull();
  });
  it("strips ledger and guild changes from personal uploads, including another player's data", () => {
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: new Date(),
      character: { name: "Other", realm: "R" },
      epgpTransactions: [{ character: "Me", realm: "R", epAmount: 999, type: "EP_AWARD", reason: "forged" }],
      itemPrices: [{ name: "Sword", gp: 1, at: new Date() }],
      readiness: [{ character: "Me", realm: "R" }, { character: "Other", realm: "R" }],
      dungeonRuns: [{ forged: true }], recipeNames: { "1": "untrusted" }
    });
    const result = personalSnapshot(snapshot, [{ name: "Me", realm: "R" }]);
    expect(result.epgpTransactions).toEqual([]);
    expect(result.itemPrices).toEqual([]);
    expect(result.dungeonRuns).toEqual([]);
    expect(result.character).toBeUndefined();
    expect(result.readiness.map((r) => r.character)).toEqual(["Me"]);
  });
});
