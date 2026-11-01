import { expect, it } from "vitest";
import { benchRotation } from "../src/services/bench-rotation.js";
const at = new Date("2026-10-30T12:00:00Z");
const candidate = (memberId: string, role = "DPS", status = "SIGNED_UP") => ({ memberId, name: memberId, role, status, signedUpAt: at });
it("suggests available players with recorded benches first and keeps roles and capacity separate", () => {
  const rows = [candidate("early"), candidate("bench", "DPS", "WAITLISTED"), candidate("maybe", "DPS", "MAYBE"), candidate("tank", "TANK")];
  const result = benchRotation(rows, [{ attendance: [{ memberId: "bench", status: "BENCHED" }, { memberId: "early", status: "PRESENT" }] }], { DPS: 1, TANK: 1 });
  expect(result.find(r => r.role === "DPS")?.rows.map(r => [r.memberId, r.suggested])).toEqual([["bench", true], ["early", false]]);
  expect(result[0]?.rows[0]?.memberId).toBe("tank");
  expect(rows[0]?.memberId).toBe("early");
});
it("never penalizes absences or missing history and uses stable signup order for ties", () => {
  const result = benchRotation([candidate("z"), candidate("a"), { ...candidate("older"), signedUpAt: new Date(at.getTime() - 1) }], [{ attendance: [{ memberId: "a", status: "ABSENT" }] }], { DPS: null });
  const rows = result.find(r => r.role === "DPS")!.rows;
  expect(rows.map(r => r.memberId)).toEqual(["older", "a", "z"]);
  expect(rows.every(r => r.benches === 0 && r.suggested === null)).toBe(true);
  expect(rows.find(r => r.memberId === "z")?.recorded).toBe(0);
});
