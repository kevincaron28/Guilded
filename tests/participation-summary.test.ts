import { describe, expect, it, vi } from "vitest";
import { createParticipationService } from "../src/services/participation.js";

describe("participation status summary", () => {
  it("returns progress without loading the season ledger into the bot", async () => {
    const query = vi.fn(async () => [
      { kind: "helper", userId: "helper", points: 15, participants: 0 },
      { kind: "summary", userId: null, points: 101, participants: 10 }
    ]);
    const season = { id: "season", guild: { settings: { timezone: "America/Toronto" } }, participation: null };
    const ledger = vi.fn(() => { throw new Error("Status must not fetch the season ledger"); });
    const database = { communitySeason: { findFirst: vi.fn(async () => season) }, communityParticipationDay: { findUnique: vi.fn(async () => null) },
      communityPoint: { findMany: ledger }, $queryRaw: query };
    const result = await createParticipationService(database as never).summary("guild", "season", "member", new Date("2030-01-08T16:00:00Z"));
    expect(result).toMatchObject({ points: 101, participants: 10, today: null, helpers: [["helper", 15]] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toContainEqual(new Date("2030-01-07T05:00:00Z"));
    expect(ledger).not.toHaveBeenCalled();
  });

  it("refuses a foreign or missing season before reading its statistics", async () => {
    const query = vi.fn();
    const database = { communitySeason: { findFirst: vi.fn(async () => null) }, $queryRaw: query };
    await expect(createParticipationService(database as never).summary("guild", "foreign", "member")).rejects.toThrow("Season not found");
    expect(query).not.toHaveBeenCalled();
  });
});
