import { describe, expect, it } from "vitest";
import { compareSnapshots } from "../scripts/compare-db-snapshots.js";

describe("database upgrade snapshot comparison", () => {
  it("rejects a missing table even if that table has no rows", () => {
    const a = { tables: { Guild: [] } };
    const b = { tables: { Guild: [], Member: [] } };
    expect(compareSnapshots(a, b)).toEqual(["Member: missing from first snapshot."]);
    expect(compareSnapshots(b, a)).toEqual(["Member: missing from second snapshot."]);
  });

  it("ignores row and object property ordering, including JSON fields", () => {
    const a = { tables: { Guild: [{ id: "a", rules: { x: 1, y: 2 } }, { id: "b" }] } };
    const b = { tables: { Guild: [{ id: "b" }, { rules: { y: 2, x: 1 }, id: "a" }] } };
    expect(compareSnapshots(a, b)).toEqual([]);
  });

  it("detects duplicate-row multiplicity, array order, values and field presence", () => {
    const cases = [
      [[{ id: 1 }, { id: 1 }], [{ id: 1 }]],
      [[{ value: [1, 2] }], [{ value: [2, 1] }]],
      [[{ value: null }], [{}]],
      [[{ value: "1" }], [{ value: 1 }]],
      [[{ date: "2026-10-23T00:00:00Z" }], [{ date: "2026-10-23T04:00:00Z" }]]
    ];
    for (const [a, b] of cases) expect(compareSnapshots({ tables: { Guild: a } }, { tables: { Guild: b } })).toHaveLength(1);
  });

  it("fails closed on empty or malformed snapshots", () => {
    for (const invalid of [null, {}, { tables: {} }, { tables: [] }, { tables: { Guild: null } }, { tables: { Guild: [null] } }]) {
      expect(() => compareSnapshots(invalid, { tables: { Guild: [] } })).toThrow("Invalid snapshot");
    }
  });

  it("does not disclose row values in differences", () => {
    const result = compareSnapshots({ tables: { Guild: [{ id: "private-member-id" }] } }, { tables: { Guild: [] } });
    expect(result).toEqual(["Guild: 1 vs 0 rows; contents differ."]);
    expect(result.join()).not.toContain("private-member-id");
  });
});
