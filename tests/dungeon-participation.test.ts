import { describe, expect, it } from "vitest";
import { participationMode, participationRecordEligible, type ParticipationRun } from "../src/services/dungeon-participation.js";

const band = { min: 15, max: 25, difficultyId: 1 };
function run(): ParticipationRun {
  return { instanceId: 36, difficultyId: 1, completedBy: "final boss", durationSec: 1000,
    players: [{ character: "Member", memberId: "m", presentSec: 1000 }, { character: "Guest", memberId: null, presentSec: 1000 }],
    competitionData: { players: [{ name: "Member", level: 20, minLevel: 20 }, { name: "Guest", level: 20, minLevel: 20 }] } };
}

describe("participation eligibility", () => {
  it("accepts exactly 50% presence, excludes 49.9%, and cannot establish an absent guild member's record", () => {
    const evidence = run();
    evidence.players[0]!.presentSec = 500;
    expect(participationMode(evidence, "Member", band)).toBe("full");
    expect(participationRecordEligible(evidence, band)).toBe(true);
    evidence.players[0]!.presentSec = 499;
    expect(participationMode(evidence, "Member", band)).toBe("none");
    expect(participationRecordEligible(evidence, band)).toBe(false);
  });
  it("keeps completion rewards but refuses records or bonuses when levels, bands or difficulty cannot qualify", () => {
    const unknown = run(); unknown.competitionData = null;
    const wrongDifficulty = run(); wrongDifficulty.difficultyId = 2;
    const below = run(); below.competitionData = { players: [{ name: "Member", level: 20, minLevel: 14 }, { name: "Guest", level: 20, minLevel: 20 }] };
    for (const evidence of [unknown, wrongDifficulty, below]) {
      expect(participationMode(evidence, "Member", band)).toBe("completion");
      expect(participationRecordEligible(evidence, band)).toBe(false);
    }
    expect(participationMode(run(), "Member", undefined)).toBe("completion");
  });
  it("requires the helped member to be linked and present, including on a manual run", () => {
    const evidence = run(); evidence.completedBy = "manual";
    evidence.competitionData = { players: [{ name: "Member", level: 20, minLevel: 20 }, { name: "Guest", level: 30, minLevel: 30 }] };
    expect(participationMode(evidence, "Guest", band)).toBe("helper");
    evidence.players[0]!.presentSec = 499;
    expect(participationMode(evidence, "Guest", band)).toBe("none");
    evidence.players[0]!.presentSec = 1000; evidence.players[0]!.memberId = null;
    expect(participationMode(evidence, "Guest", band)).toBe("none");
  });
});
