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
    const rows: { memberId: string; option: number }[] = [];
    const match = (where: { memberId?: string; option?: number | { not: number } }) => rows.filter((row) => (where.memberId === undefined || row.memberId === where.memberId)
      && (where.option === undefined || (typeof where.option === "number" ? row.option === where.option : row.option !== where.option.not)));
    return {
      rows,
      db: {
        poll: { findFirst: async () => poll },
        pollVote: {
          deleteMany: async ({ where }: { where: { memberId: string; option?: number | { not: number } } }) => { for (const row of match(where)) rows.splice(rows.indexOf(row), 1); },
          upsert: async ({ create }: { create: { memberId: string; option: number } }) => { if (!match(create).length) rows.push({ memberId: create.memberId, option: create.option }); },
          findFirst: async ({ where }: { where: { memberId: string; option: number } }) => match(where)[0] ?? null,
          count: async ({ where }: { where: { memberId: string } }) => match(where).length,
          create: async ({ data }: { data: { memberId: string; option: number } }) => { rows.push({ memberId: data.memberId, option: data.option }); },
          findMany: async ({ where }: { where: { memberId: string } }) => match(where)
        }
      }
    };
  }
  const open = { id: "p", guildId: "g", options: ["A", "B", "C", "D"], closed: false, closesAt: null, maxChoices: 1 };

  it("records one vote per member and lets them change it", async () => {
    const { db, rows } = fake(open);
    const service = createPollService(db as never);
    await service.vote("p", "g", "m1", 0);
    expect((await service.vote("p", "g", "m1", 1)).selected).toEqual([1]);
    await service.vote("p", "g", "m2", 0);
    expect(rows.map((row) => [row.memberId, row.option])).toEqual([["m1", 1], ["m2", 0]]);
  });

  it("lets a member pick several options up to the limit and remove one", async () => {
    const { db } = fake({ ...open, maxChoices: 2 });
    const service = createPollService(db as never);
    await service.vote("p", "g", "m1", 0);
    expect((await service.vote("p", "g", "m1", 2)).selected).toEqual([0, 2]);
    await expect(service.vote("p", "g", "m1", 3)).rejects.toThrow(/up to 2/);
    expect((await service.vote("p", "g", "m1", 0)).selected).toEqual([2]);
    expect((await service.vote("p", "g", "m1", 3)).selected).toEqual([2, 3]);
  });

  it("refuses votes on closed, expired or unknown polls and bad options", async () => {
    await expect(createPollService(fake({ ...open, closed: true }).db as never).vote("p", "g", "m", 0)).rejects.toThrow(/closed/);
    await expect(createPollService(fake({ ...open, closesAt: new Date(Date.now() - 1000) }).db as never).vote("p", "g", "m", 0)).rejects.toThrow(/closed/);
    await expect(createPollService(fake(null).db as never).vote("p", "g", "m", 0)).rejects.toThrow(/no longer exists/);
    await expect(createPollService(fake(open).db as never).vote("p", "g", "m", 9)).rejects.toThrow(/does not exist/);
  });
});
