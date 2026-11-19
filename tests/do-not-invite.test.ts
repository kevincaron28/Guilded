import { describe, expect, it, vi } from "vitest";
import { createDoNotInviteService, dniExpiryDate, dniMatchesDetailed, dniNamesForAddon, dniWarning, type DniEntry } from "../src/services/do-not-invite.js";
import { standingsToLua } from "../companion/standings-format.mjs";

const NOW = new Date("2027-03-04T12:00:00Z");
const entry = (over: Partial<DniEntry> = {}): DniEntry => ({ id: "e", name: "Grimbold Ashvane", realm: null, discordUserId: null, reason: "Ninja", addedBy: "1", createdAt: NOW, ...over });

describe("do-not-invite 9.4", () => {
  it("never matches expired or cleared entries, and an appealed one still matches", () => {
    const list = [entry({ id: "old", expiresAt: new Date("2027-01-01") }), entry({ id: "gone", status: "CLEARED" }), entry({ id: "live", status: "APPEALED", expiresAt: new Date("2028-01-01") })];
    expect(dniMatchesDetailed(list, { names: ["Grimbold Ashvane"] }, NOW).map((m) => m.entry.id)).toEqual(["live"]);
  });

  it("says possible when only a name without realm or Discord id matched", () => {
    const only = dniMatchesDetailed([entry()], { names: ["Grimbold Ashvane"] }, NOW)[0]!;
    expect(only.certain).toBe(false);
    expect(dniWarning(only.entry, "<@9>", "invite", only.certain)).toContain("possibly");
    expect(dniMatchesDetailed([entry({ realm: "Forever" })], { names: ["Grimbold Ashvane-Forever"] }, NOW)[0]!.certain).toBe(true);
    expect(dniMatchesDetailed([entry({ discordUserId: "42", name: "Other" })], { discordUserId: "42" }, NOW)[0]!.certain).toBe(true);
  });

  it("an alias group makes every name of the person match", () => {
    const list = [entry({ id: "a", name: "Main One", aliasGroup: "g" }), entry({ id: "b", name: "Alt Two", aliasGroup: "g" })];
    expect(dniMatchesDetailed(list, { names: ["Alt Two"] }, NOW).map((m) => m.entry.id).sort()).toEqual(["a", "b"]);
  });

  it("gives the addon names only, active ones", () => {
    const names = dniNamesForAddon([entry({ realm: "Forever", discordUserId: "42" }), entry({ name: "Old", expiresAt: new Date("2027-01-01") })], NOW);
    expect(names).toEqual(["Grimbold Ashvane-Forever"]);
  });

  it("expiry choices: a year by default, forever is null", () => {
    expect(dniExpiryDate(undefined, NOW)!.getTime() - NOW.getTime()).toBe(365 * 86_400_000);
    expect(dniExpiryDate("forever", NOW)).toBeNull();
    expect(dniExpiryDate("1m", NOW)!.getTime() - NOW.getTime()).toBe(30 * 86_400_000);
  });

  it("add fills the alias group from the same member's other characters and records an audit row", async () => {
    const created: Record<string, unknown>[] = [];
    const doNotInvite = { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: `id${created.length}`, ...data }; }), findMany: vi.fn(async () => []) };
    const character = { findMany: vi.fn(async (args: { where: { memberId?: string } }) => args.where.memberId ? [{ name: "Grimbold Ashvane" }, { name: "Alt Twin" }] : [{ memberId: "m1", name: "Grimbold Ashvane" }]) };
    const member = { findUnique: vi.fn(async () => ({ discordUserId: "123456789" })) };
    const auditLog = { create: vi.fn(async () => ({})) };
    const service = createDoNotInviteService({ doNotInvite, character, member, auditLog } as never);
    const added = await service.add("g", { name: "Grimbold Ashvane", reason: "Kicked", addedBy: "1", now: NOW });
    expect(added.aliasGroup).toBeTruthy();
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({ name: "Alt Twin", aliasGroup: added.aliasGroup, discordUserId: "123456789" });
    expect(created[0]!['expiresAt']).toEqual(dniExpiryDate("1y", NOW));
    expect(auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "DNI_ADDED" }) });
  });

  it("clear marks the entry and its alias group cleared and audits it", async () => {
    const doNotInvite = { findFirst: vi.fn(async () => ({ id: "a", aliasGroup: "g" })), updateMany: vi.fn(async () => ({ count: 2 })) };
    const auditLog = { create: vi.fn(async () => ({})) };
    await createDoNotInviteService({ doNotInvite, auditLog } as never).clear("g", "a", "9");
    expect(doNotInvite.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ aliasGroup: "g" }), data: expect.objectContaining({ status: "CLEARED", clearedBy: "9" }) });
    expect(auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "DNI_CLEARED" }) });
  });

  it("the standings file carries the names (and nothing else) only when given, and no reason", () => {
    const base = { updatedAt: "2027-03-04T00:00:00Z", baseGp: 0, standings: [] };
    const lua = standingsToLua({ ...base, officerDni: ["Grimbold Ashvane-Forever"] } as never);
    expect(lua).toContain('GuildedDni = { names = {');
    expect(lua).toContain('"Grimbold Ashvane-Forever"');
    expect(standingsToLua(base as never)).toContain("GuildedDni = nil");
  });
});
