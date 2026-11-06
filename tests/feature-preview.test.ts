import { describe, expect, it } from "vitest";
import { previewAllows } from "../src/services/feature-preview.js";

describe("8.5 preview switch", () => {
  it("allows every server when the list is unset or blank (the released behaviour)", () => {
    expect(previewAllows("111", undefined)).toBe(true);
    expect(previewAllows("111", "  ")).toBe(true);
  });

  it("allows only listed servers while the preview list is set", () => {
    const list = "222, 333 444";
    expect(previewAllows("222", list)).toBe(true);
    expect(previewAllows("444", list)).toBe(true);
    expect(previewAllows("111", list)).toBe(false);
    expect(previewAllows(null, list)).toBe(false);
  });
});
