import { describe, expect, it, vi } from "vitest";
import { applyRaidEpProposal, computeRaidEpProposal, raidEpRef } from "../src/services/ep-award.js";
import { attendanceRate } from "../src/services/merit.js";

function database(paidRefs: string[] = []) {
  const created: { memberId: string; epAmount: number; sourceRef: string }[] = [];
  return {
    created,
    db: {
      raid: {
        findFirst: vi.fn().mockResolvedValue({
          id: "r1", title: "Molten Core",
          bosses: [{ status: "KILLED" }, { status: "KILLED" }],
          attendance: [
            { memberId: "m1", status: "PRESENT", member: { displayName: "Kev" } },
            { memberId: "m2", status: "LATE", member: { displayName: "Bob" } },
            { memberId: "m3", status: "ABSENT", member: { displayName: "Amy" } }
          ]
        })
      },
      guildSettings: {
        findUnique: vi.fn().mockResolvedValue({ attendanceDkp: 10, lateAttendanceDkp: 5, bossKillDkp: 3, epCompletionBonus: 4 })
      },
      epgpTransaction: {
        findMany: vi.fn().mockResolvedValue(paidRefs.map((sourceRef) => ({ sourceRef }))),
        create: vi.fn().mockImplementation(async ({ data }) => { created.push(data); return data; })
      }
    }
  };
}

describe("raid EP proposal", () => {
  it("adds attendance, per-boss EP, and the full-clear bonus; skips absentees", async () => {
    const { db } = database();
    const proposal = await computeRaidEpProposal(db as never, "g1", "r1");
    expect(proposal.rows.map((row) => [row.name, row.ep])).toEqual([["Kev", 20], ["Bob", 15]]);
  });

  it("never pays the same raid twice", async () => {
    const { db, created } = database([raidEpRef("r1", "m1")]);
    const result = await applyRaidEpProposal(db as never, "g1", "r1", "officer");
    expect(result).toMatchObject({ created: 1, skipped: 1, total: 15 });
    expect(created.map((row) => row.memberId)).toEqual(["m2"]);
    expect(created[0]?.sourceRef).toBe("raid-ep:r1:m2");
  });
});

describe("bench credit", () => {
  it("pays a benched player the same EP as the raid (EPGP standby), and counts full attendance", async () => {
    const { db } = database();
    (db.raid.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1", title: "Molten Core", bosses: [{ status: "KILLED" }, { status: "KILLED" }],
      attendance: [
        { memberId: "m1", status: "PRESENT", member: { displayName: "Kev" } },
        { memberId: "m4", status: "BENCHED", member: { displayName: "Zed" } }
      ]
    });
    const proposal = await computeRaidEpProposal(db as never, "g1", "r1");
    // Kev: 10 attendance + 2 kills x 3 + 4 clear bonus; Zed (bench) gets the same, as EPGP standby does.
    expect(proposal.rows.map((row) => [row.name, row.ep, row.status])).toEqual([["Kev", 20, "PRESENT"], ["Zed", 20, "BENCHED"]]);
  });
});

describe("attendance rate with bench credit", () => {
  it("counts benched as a full raid and late as half", () => {
    expect(attendanceRate(["PRESENT", "BENCHED", "LATE", "ABSENT"], 4)).toBe(0.625);
  });
});

describe("per-core EP rules", () => {
  it("uses the core's own values where set and the guild defaults elsewhere", async () => {
    const { db } = database();
    (db.raid.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1", title: "Onyxia", bosses: [{ status: "KILLED" }],
      core: { attendanceEp: 20, lateEp: null, bossEp: 0, completionEp: null },
      attendance: [
        { memberId: "m1", status: "PRESENT", member: { displayName: "Kev" } },
        { memberId: "m2", status: "LATE", member: { displayName: "Bob" } }
      ]
    });
    const proposal = await computeRaidEpProposal(db as never, "g1", "r1");
    // Present: core 20 + 1 boss x core 0 + full clear (guild default 4) = 24. Late: guild default 5 + 0 + 4 = 9.
    expect(proposal.rows.map((row) => [row.name, row.ep])).toEqual([["Kev", 24], ["Bob", 9]]);
    expect(proposal.perBoss).toBe(0);
  });
});
