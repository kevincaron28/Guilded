import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ remove: vi.fn(), create: vi.fn(), transaction: vi.fn(), eventLinks: vi.fn(async () => []) }));
vi.mock("../src/database.js", () => ({ prisma: { $transaction: mocks.transaction, discordEventLink: { findMany: mocks.eventLinks } } }));
import { executeSetupReset, performUninstall } from "../src/commands/uninstall.js";
const impact = { coreCategories: [], removableChannels: [{ id: "owned", name: "inscriptions" }], keptChannels: ["<#manual>"], roleNames: [], counts: { members: 2, characters: 3, raids: 1, epgp: 4, loot: 1, imports: 1, dungeonRuns: 1 } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async work => work({ guild: { delete: mocks.remove, create: mocks.create } }));
});
describe("destructive setup reset", () => {
  it("deletes only previewed channels and replaces this guild with fresh settings in one transaction", async () => {
    const deleted = vi.fn();
    const guild = { id: "discord", name: "Guild", scheduledEvents: { fetch: async () => new Map() }, channels: { fetch: async (id?: string) => id ? { delete: deleted } : null, cache: { find: () => undefined } } };
    const text = await performUninstall(guild as never, "database-id", impact, true);
    expect(deleted).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "database-id" } });
    expect(mocks.create).toHaveBeenCalledWith({ data: { discordId: "discord", name: "Guild", settings: { create: { dataResetAt: expect.any(Date) } } } });
    expect(text).toContain("/setup start"); expect(text).toContain("<#manual>");
  });
  it("does not wipe the database when a channel deletion fails", async () => {
    const guild = { scheduledEvents: { fetch: async () => new Map() }, channels: { fetch: async () => ({ delete: async () => { throw new Error("Forbidden"); } }) } };
    await expect(performUninstall(guild as never, "guild", impact, true)).rejects.toThrow("Forbidden");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects nonadministrators before gathering or deleting anything", async () => {
    const reply = vi.fn();
    await executeSetupReset({ guild: { ownerId: "owner" }, guildId: "guild", user: { id: "member" }, member: { permissions: { has: () => false } }, reply } as never);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, content: expect.stringContaining("Administrator") }));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
