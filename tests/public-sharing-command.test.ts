import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guild: vi.fn(), upsert: vi.fn(), permission: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { guild: { findUnique: mocks.guild }, guildSettings: { upsert: mocks.upsert } } }));
vi.mock("../src/permissions.js", () => ({ hasPermission: mocks.permission }));
import { executePublicLeaderboard } from "../src/commands/public-leaderboard.js";

beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockReturnValue(true); mocks.guild.mockResolvedValue({ id: "g1" }); });
describe("officer sharing command (always on)", () => {
  it.each([null, new Date("2026-11-10T12:00:00Z")])("preserves the stored cutoff and discloses the eligibility window (%s)", async since => {
    mocks.upsert.mockResolvedValue({ publicDungeonRuns: true, publicDungeonRunsSince: since });
    const reply = vi.fn();
    await executePublicLeaderboard({ guildId: "discord", member: {}, options: { getBoolean: () => true }, reply } as never);
    expect(mocks.upsert).toHaveBeenCalledWith({ where: { guildId: "g1" }, create: { guildId: "g1", publicDungeonRuns: true }, update: { publicDungeonRuns: true } });
    const text = reply.mock.calls[0]![0].content as string;
    expect(text).toContain(since ? "started since <t:" : "last 30 days");
    expect(text).toContain("including non-guild players");
    expect(text).toContain("Delete my data");
  });
  it("rejects unauthorized changes before reading guild data", async () => {
    mocks.permission.mockReturnValue(false);
    await executePublicLeaderboard({ guildId: "discord", member: {}, reply: vi.fn() } as never);
    expect(mocks.guild).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
