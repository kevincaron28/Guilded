import { describe, expect, it, vi } from "vitest";

const reconcile = vi.fn(async () => new Map<string, number>());
vi.mock("../src/services/dungeon-evidence-awards.js", () => ({ reconcileEvidenceAwards: reconcile }));

const { creditHeldRunPlayers, describeRunCredit } = await import("../src/services/dungeon-held-credit.js");

// A Ragefire party: Crashin (linked uploader) plus two guildmates who were not linked at import.
const heldRows = [
  { id: "p-xaldin", runId: "run-1", character: "Xaldin" },
  { id: "p-pirata", runId: "run-1", character: "El Pirata" },
  { id: "p-stranger", runId: "run-1", character: "Randomguy" }
];

function fakeTx() {
  const updates: { id: string; memberId: string }[] = [];
  const tx = {
    dungeonRunPlayer: {
      findMany: vi.fn(async () => heldRows),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { memberId: string } }) => { updates.push({ id: where.id, memberId: data.memberId }); })
    }
  };
  return { tx, updates };
}

describe("held dungeon credit", () => {
  it("credits guildmates once they are linked, including a two-word Forever name", async () => {
    reconcile.mockClear();
    const { tx, updates } = fakeTx();
    const characters = [
      { name: "Crashin", realm: "", memberId: "m-crashin" },
      { name: "Xaldin", realm: "", memberId: "m-xaldin" },
      { name: "El Pirata", realm: "", memberId: "m-pirata" }
    ];
    const result = await creditHeldRunPlayers(tx as never, "g", characters, "bot");
    expect(result).toEqual({ players: 2, runs: 1 });
    expect(updates).toEqual([{ id: "p-xaldin", memberId: "m-xaldin" }, { id: "p-pirata", memberId: "m-pirata" }]);
    expect(reconcile).toHaveBeenCalledWith(tx, "g", "run-1", ["m-xaldin", "m-pirata"], "bot", expect.any(Date));
  });

  it("matches a pre-8.5 first-name row to the full name in the run", async () => {
    reconcile.mockClear();
    const { tx, updates } = fakeTx();
    const result = await creditHeldRunPlayers(tx as never, "g", [{ name: "El", realm: "", memberId: "m-pirata" }], "bot");
    expect(result.players).toBe(1);
    expect(updates).toEqual([{ id: "p-pirata", memberId: "m-pirata" }]);
  });

  it("keeps holding while nobody is linked, and does nothing when nothing is held", async () => {
    reconcile.mockClear();
    const { tx, updates } = fakeTx();
    expect(await creditHeldRunPlayers(tx as never, "g", [{ name: "Crashin", realm: "", memberId: "m" }], "bot")).toEqual({ players: 0, runs: 0 });
    expect(updates).toEqual([]);
    expect(reconcile).not.toHaveBeenCalled();
    tx.dungeonRunPlayer.findMany.mockResolvedValueOnce([]);
    expect(await creditHeldRunPlayers(tx as never, "g", [], "bot")).toEqual({ players: 0, runs: 0 });
  });
});

describe("describeRunCredit", () => {
  const run = {
    dungeonName: "Ragefire Chasm", state: "COMPLETED", valid: true, invalidReason: null,
    players: [
      { character: "Crashin", memberId: "m-crashin", inGuild: true, presentSec: 900, member: { displayName: "Crash" } },
      { character: "Xaldin", memberId: null, inGuild: true, presentSec: 900 },
      { character: "El Pirata", memberId: null, inGuild: true, presentSec: 900 },
      { character: "Randomguy", memberId: null, inGuild: false, presentSec: 900 }
    ]
  };
  it("says who earned points and why the others did not", () => {
    const text = describeRunCredit(run, [{ memberId: "m-crashin", amount: 12 }]);
    expect(text).toContain("Crashin (Crash): +12 point(s)");
    expect(text).toMatch(/Xaldin: guildmate, not linked.*\/guilded verify/);
    expect(text).toMatch(/El Pirata: guildmate, not linked/);
    expect(text).toMatch(/Randomguy: not linked and not flagged/);
  });
  it("explains a linked player with no points and an invalid run", () => {
    expect(describeRunCredit({ ...run, players: [{ ...run.players[0]!, memberId: "m" }] }, [])).toContain("linked, no points from this run");
    expect(describeRunCredit({ ...run, valid: false, invalidReason: "too short (30s)" }, [])).toContain("not counted (too short (30s))");
  });
});
