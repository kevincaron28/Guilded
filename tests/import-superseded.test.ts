import { describe, expect, it, vi } from "vitest";
import { createAddonImportService } from "../src/services/addon-import.js";
import { shouldTellApplyFailure } from "../src/companion-api.js";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));

describe("a superseded import", () => {
  it("is not applied when an officer types its id: the answer says a newer upload replaced it", async () => {
    const tx = { $executeRaw: vi.fn(async () => 1), addonImport: { findFirst: vi.fn(async () => ({ id: "i1", guildId: "g", status: "SUPERSEDED", payload: {} })) }, guildSettings: { findUnique: vi.fn() } };
    const database = { $transaction: async (work: (client: unknown) => unknown) => work(tx) };
    await expect(createAddonImportService(database as never).apply("g", "i1", "officer")).rejects.toThrow(/superseded by a newer upload/);
    expect(tx.guildSettings.findUnique).not.toHaveBeenCalled();   // nothing was read or written past the check
  });
});

describe("the member's late-failure private message is throttled like the officer notice", () => {
  it("the same member, guild and reason is told once; another reason or member is told", () => {
    const now = Date.now();
    expect(shouldTellApplyFailure("member:g:u1:timeout", now)).toBe(true);
    expect(shouldTellApplyFailure("member:g:u1:timeout", now + 1_000)).toBe(false);
    expect(shouldTellApplyFailure("member:g:u1:other-reason", now + 1_000)).toBe(true);
    expect(shouldTellApplyFailure("member:g:u2:timeout", now + 1_000)).toBe(true);
  });
});
