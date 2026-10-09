import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ require: vi.fn(), settings: vi.fn() }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: context.require,
  guildService: { getSettings: context.settings }
}));
import { executeSetup } from "../src/commands/setup.js";

beforeEach(() => vi.clearAllMocks());
describe("setup first acknowledgement", () => {
  it("acknowledges the interaction before database access, including denied officer access", async () => {
    const deferReply = vi.fn(async () => undefined), editReply = vi.fn(async () => undefined);
    context.require.mockImplementation(async () => {
      expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
      return { guildId: "g", memberId: "m" };
    });
    context.settings.mockResolvedValue({ language: "en" });
    await executeSetup({ guild: { id: "d" }, guildId: "d", member: { permissions: { has: () => false }, roles: { cache: { some: () => false } } }, deferReply, editReply } as never);
    expect(editReply).toHaveBeenCalledWith({ content: expect.stringContaining("Only server admins") });
  });
});
