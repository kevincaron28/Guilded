import { describe, expect, it, vi } from "vitest";

// 12 Nov 2026: uploads passed the Worker's 20 s limit while the database was idle: the handler awaited Discord side
// effects (cards, notices, directory refreshes). The response must never wait on them, and each upload logs its phases.
const mocks = vi.hoisted(() => ({
  apply: vi.fn(async () => ({ epgpTransactions: [{}], readinessSnapshots: [], discovery: { discovered: 2 }, held: { rows: [] }, voided: 0, rejected: [] })),
  followUp: vi.fn(() => new Promise<void>(() => { /* Discord never answers */ })),
  fetchGuild: vi.fn(() => new Promise(() => { /* never resolves */ }))
}));
vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));
vi.mock("../src/services/import-followup.js", () => ({ followUpImport: mocks.followUp }));
vi.mock("../src/services/addon-import.js", async (original) => ({
  ...await original<typeof import("../src/services/addon-import.js")>(),
  createAddonImportService: () => ({ apply: mocks.apply })
}));
vi.mock("../src/services/audit.js", async (original) => ({
  ...await original<typeof import("../src/services/audit.js")>(),
  createAuditService: () => ({ record: async () => undefined })
}));

import { autoApplyImportWith, createUploadTimer, inBackground } from "../src/companion-api.js";

describe("uploads never wait on Discord", () => {
  it("returns the import counts at once while the Discord follow-up never finishes", async () => {
    const client = { guilds: { fetch: mocks.fetchGuild } };
    const answer = await Promise.race([
      autoApplyImportWith({ guildId: "g", discordId: "d", importId: "i", createdBy: "u", since: new Date(), retried: false, client: client as never }),
      new Promise((resolve) => setTimeout(() => resolve("waited on Discord"), 1500))
    ]);
    expect(answer).toEqual({ epgp: 1, discovered: 2, held: 0, voided: 0, rejected: 0 });
  });

  it("a background side effect that never resolves or throws does not hold or break the caller", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    inBackground("Never", () => new Promise(() => undefined));
    inBackground("Broken", async () => { throw new Error("discord is down"); });
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(Date.now() - started).toBeLessThan(500);
    expect(warn).toHaveBeenCalledWith("Broken failed", expect.any(Error));
    warn.mockRestore();
  });
});

describe("the upload timing line", () => {
  it("lists only phases over 200 ms, with a short hash of the guild and no names", async () => {
    const timer = createUploadTimer();
    await timer.time("fast", async () => 1);
    await timer.time("slow", () => new Promise((resolve) => setTimeout(resolve, 260)));
    const line = timer.line("guild-internal-id-123", 4096, true);
    expect(line).toMatch(/^upload guild=[0-9a-f]{8} total=\d+ bytes=4096 officer=1 phases=slow:\d+$/);
    expect(line).not.toContain("guild-internal-id-123");
    expect(createUploadTimer().line("g", 0, false)).toMatch(/officer=0 phases=-$/);
  });
});
