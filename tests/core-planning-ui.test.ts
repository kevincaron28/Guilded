import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ core: vi.fn(), settings: vi.fn(), update: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { raidCore: { findFirstOrThrow: mocks.core, update: mocks.update }, guildSettings: { findUnique: mocks.settings } } }));
import { editCoreComposition, editCoreSchedule } from "../src/commands/core-planning.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.core.mockResolvedValue({ id: "core", name: "December launch", weeklySchedule: null, weeklyHorizonDays: 6 });
  mocks.settings.mockResolvedValue({ timezone: "America/Toronto" });
});

describe("core planning forms", () => {
  it("saves a validated composition scoped to the current guild", async () => {
    const submitted = { fields: { getTextInputValue: (key: string) => ({ size: "20", tanks: "2", healers: "4", dps: "14" })[key] }, deferReply: vi.fn(), editReply: vi.fn() };
    const choice = { isStringSelectMenu: () => true, values: ["20"], showModal: vi.fn(async modal => modal.toJSON()), awaitModalSubmit: vi.fn(async () => submitted) };
    const i = { id: "click", user: { id: "leader" }, deferReply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn(async () => ({ awaitMessageComponent: async () => choice })) };
    expect(await editCoreComposition(i as never, "guild", "core")).toContain("20 joueurs");
    expect(mocks.core).toHaveBeenCalledWith({ where: { id: "core", guildId: "guild" } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "core" }, data: { raidSize: 20, tankLimit: 2, healerLimit: 4, dpsLimit: 14 } });
    expect(choice.showModal.mock.calls[0]![0].toJSON().components).toHaveLength(3);
    expect(i.editReply.mock.calls[0]![0].components[0].toJSON().components[0].options.map((option: { value: string }) => option.value)).toEqual(["10", "20", "40"]);
  });
  it("does not save a schedule unless the officer confirms its dated preview", async () => {
    const submitted = { fields: { getTextInputValue: (key: string) => ({ time: "20:00", start: "2026-12-04", days: "28", custom: "" })[key] },
      reply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn(async () => ({ awaitMessageComponent: async () => { throw new Error("expired"); } })) };
    const choice = { isStringSelectMenu: () => true, values: ["5"], showModal: vi.fn(async modal => modal.toJSON()), awaitModalSubmit: vi.fn(async () => submitted) };
    const i = { id: "click", user: { id: "leader" }, reply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn(async () => ({ awaitMessageComponent: async () => choice })) };
    expect(await editCoreSchedule(i as never, "guild", "core")).toBeNull();
    expect(submitted.reply.mock.calls[0]![0].content).toContain("2026-12-04");
    expect(submitted.reply.mock.calls[0]![0].content).toContain("America/Toronto");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(choice.showModal.mock.calls[0]![0].toJSON().components).toHaveLength(4);
  });
});
