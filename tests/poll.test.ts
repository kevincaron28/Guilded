import { describe, expect, it } from "vitest";
import { cleanOptions, createPollService, resultBar, tallyVotes } from "../src/services/poll.js";

describe("poll helpers", () => {
  it("cleans options: trims, drops blanks, needs two different ones, keeps five", () => {
    expect(cleanOptions([" Tue ", "", "Wed", null, "Thu", "Fri", "Sat", "Sun"])).toEqual(["Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(cleanOptions(Array.from({ length: 30 }, (_, i) => `Option ${i}`))).toHaveLength(25);
    expect(() => cleanOptions(["Only", ""])).toThrow(/at least 2/);
    expect(() => cleanOptions(["Yes", "yes"])).toThrow(/different/);
  });

  it("tallies votes and ignores out-of-range options", () => {
    expect(tallyVotes(3, [{ option: 0 }, { option: 2 }, { option: 2 }, { option: 9 }, { option: -1 }])).toEqual([1, 0, 2]);
  });

  it("draws a result bar", () => {
    expect(resultBar(3, 4)).toBe("████████░░ 75% (3)");
    expect(resultBar(0, 0)).toBe("░░░░░░░░░░ 0% (0)");
  });
});

describe("poll voting", () => {
  function fake(poll: Record<string, unknown> | null) {
    const votes = new Map<string, number>();
    return {
      votes,
      db: {
        poll: { findFirst: async () => poll },
        pollVote: {
          upsert: async ({ create, update, where }: { create: { option: number }; update: { option: number }; where: { pollId_memberId: { memberId: string } } }) => {
            const key = where.pollId_memberId.memberId;
            votes.set(key, votes.has(key) ? update.option : create.option);
          }
        }
      }
    };
  }
  const open = { id: "p", guildId: "g", options: ["A", "B"], closed: false, closesAt: null };

  it("records one vote per member and lets them change it", async () => {
    const { db, votes } = fake(open);
    const service = createPollService(db as never);
    await service.vote("p", "g", "m1", 0);
    await service.vote("p", "g", "m1", 1);
    await service.vote("p", "g", "m2", 0);
    expect([...votes.entries()]).toEqual([["m1", 1], ["m2", 0]]);
  });

  it("refuses votes on closed, expired or unknown polls and bad options", async () => {
    await expect(createPollService(fake({ ...open, closed: true }).db as never).vote("p", "g", "m", 0)).rejects.toThrow(/closed/);
    await expect(createPollService(fake({ ...open, closesAt: new Date(Date.now() - 1000) }).db as never).vote("p", "g", "m", 0)).rejects.toThrow(/closed/);
    await expect(createPollService(fake(null).db as never).vote("p", "g", "m", 0)).rejects.toThrow(/no longer exists/);
    await expect(createPollService(fake(open).db as never).vote("p", "g", "m", 5)).rejects.toThrow(/does not exist/);
  });
});
