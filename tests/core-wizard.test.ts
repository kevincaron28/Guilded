import { describe, expect, it } from "vitest";
import { parseEpField } from "../src/commands/core-wizard.js";

describe("core wizard EP form", () => {
  it("empty keeps the guild default, numbers are read, anything else is refused", () => {
    expect(parseEpField("")).toBeNull();
    expect(parseEpField("  ")).toBeNull();
    expect(parseEpField("20")).toBe(20);
    expect(parseEpField(" 0 ")).toBe(0);
    expect(() => parseEpField("ten")).toThrow(/not a whole number/);
    expect(() => parseEpField("-5")).toThrow(/not a whole number/);
    expect(() => parseEpField("1.5")).toThrow(/not a whole number/);
  });
});

describe("EP form (step 3 of /core setup)", () => {
  it("builds for a long core name and empty values without breaking Discord's limits", async () => {
    const { epModal } = await import("../src/commands/core-wizard.js");
    const core = { name: "A very long raid core name that is fifty characters", attendanceEp: null, lateEp: 5, bossEp: null, completionEp: null } as never;
    const json = epModal(core).toJSON();
    expect(json.title.length).toBeLessThanOrEqual(45);
    expect(json.components).toHaveLength(4);
    for (const row of json.components as unknown as { components: unknown[] }[]) for (const input of row.components) {
      expect((input as { label: string }).label.length).toBeLessThanOrEqual(45);
    }
  });
});
