import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), remove: vi.fn(), save: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: {
  groupAlert: { findUnique: mocks.find, upsert: mocks.upsert, deleteMany: mocks.remove },
  character: { findMany: async () => [] }
} }));
vi.mock("../src/commands/context.js", () => ({ guildService: {
  ensureGuild: async () => ({ id: "guild" }), ensureMember: async () => ({ id: "member" }), getSettings: async () => ({ language: "en" })
} }));
vi.mock("../src/services/group-watch.js", () => ({ saveGroupWatch: mocks.save }));
import { alertPanel, handleGroupAlertComponent } from "../src/commands/group-alerts.js";

const subscription = { optedIn: true, timezone: "UTC", createdAt: "2026-10-30T12:00:00Z", expiresAt: "2026-11-01T12:00:00Z",
  weekdays: [5], available: { start: 1200, end: 1380 }, quiet: { start: 0, end: 480 }, types: ["group"] };
const alert = { kinds: ["DUNGEON"], roles: ["HEALER"], subscription };
beforeEach(() => { vi.clearAllMocks(); mocks.find.mockResolvedValue(alert); });
function interaction(action: string) {
  return { customId: `galert:${action}`, guild: { id: "discord", name: "Guild" }, user: { id: "actor", username: "Actor" },
    values: ["TANK"], isStringSelectMenu: () => true, update: vi.fn() };
}
it("explains advanced preferences without promising legacy pings", () => {
  for (const lang of ["en", "fr"] as const) {
    const panel = alertPanel(lang, alert, []);
    expect(panel.content).toContain("/dungeon watch action:status");
    expect(panel.content).not.toContain("You are pinged");
    expect(panel.components).toHaveLength(1);
  }
});
it("stale legacy controls cannot replace advanced filters or roles", async () => {
  const i = interaction("roles");
  await handleGroupAlertComponent(i as never);
  expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  expect(i.update).toHaveBeenCalledOnce();
});
it("off uses the shared reservation lock path without erasing delivery history", async () => {
  mocks.save.mockResolvedValue({ ...alert, subscription: { ...subscription, optedIn: false } });
  const i = interaction("off"); await handleGroupAlertComponent(i as never);
  expect(mocks.save).toHaveBeenCalledWith(expect.anything(), "guild", "member", { ...subscription, optedIn: false }, ["HEALER"]);
  expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
});
