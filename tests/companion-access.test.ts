import { describe, expect, it, vi } from "vitest";
import { CompanionUnavailable, companionAccess, personalSnapshot } from "../src/services/companion-access.js";
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
    await expect(companionAccess(db as never, undefined, "g", "d", "x".repeat(43))).rejects.toBeInstanceOf(CompanionUnavailable);
    const client = { guilds: { fetch: async () => ({ members: { fetch: async () => { throw { code: 10007 }; } } }) } };
    expect(await companionAccess(db as never, client as never, "g", "d", "x".repeat(43))).toBeNull();
  });
  it("does not invalidate credentials when Discord returns a temporary failure", async () => {
    const db = { companionCredential: { findFirst: async () => ({ memberId: "m", member: { discordUserId: "u" } }) } };
    const client = { guilds: { fetch: async () => ({ members: { fetch: async () => { throw { status: 503 }; } } }) } };
    await expect(companionAccess(db as never, client as never, "g", "d", "x".repeat(43))).rejects.toBeInstanceOf(CompanionUnavailable);
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

  it("keeps a member's own battleground reports and drops everyone else's", () => {
    const report = { version: 1, reportId: "self-report-001", adapter: "forever-postmatch-v1", edition: "forever",
      character: "Me", realm: "R", realmType: "normal", mode: "casual", mapId: 489, bracket: "60",
      endedAt: 1_762_000_000, durationSeconds: 600, outcome: "win", presence: "complete",
      reloaded: false, postmatch: true, consent: true };
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: new Date(), gameEdition: "forever", battlegroundReports: [
      report,
      { ...report, reportId: "self-report-002", character: "Other" },
      { ...report, reportId: "self-report-003", edition: "retail", adapter: "retail-postmatch-v1" }
    ] });
    const result = personalSnapshot(snapshot, [{ name: "Me", realm: "R" }]);
    expect(result.battlegroundReports.map((row) => row.reportId)).toEqual(["self-report-001"]);
    expect(result.epgpTransactions).toEqual([]);
  });
});
