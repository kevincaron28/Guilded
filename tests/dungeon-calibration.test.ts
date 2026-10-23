import { describe, expect, it } from "vitest";
import { calibrationSample, type CalibrationSample } from "../src/services/dungeon-calibration.js";

const sample = (i: number, extra: Partial<CalibrationSample> = {}): CalibrationSample => ({ id: `run-${i}`, seconds: 1800,
  endedAt: new Date(`2026-11-${10 + Math.floor(i / 5)}T12:00:00Z`), crew: Array.from({ length: 5 }, (_, p) => `crew${i % 5}-${p}`),
  build: "12345", startTrigger: "first combat", ...extra });
describe("calibration review sample", () => {
  it("requires 20 daily crew samples, five different crews, and multiple UTC days", () => {
    expect(calibrationSample(Array.from({ length: 20 }, (_, i) => sample(i)))).toMatchObject({ ready: true, crews: 5, days: 4, median: 1800, p25: 1800, p75: 1800 });
    expect(calibrationSample(Array.from({ length: 100 }, (_, i) => sample(i, { crew: ["a", "b", "c", "d", "e"] })))).toMatchObject({ ready: false, crews: 1 });
  });
  it("limits repeats to one crew/day median and collapses overlapping replacement crews", () => {
    const same = [sample(0, { seconds: 600 }), sample(0, { id: "b", seconds: 1800 }), sample(0, { id: "c", seconds: 1200 })];
    expect(calibrationSample(same)).toMatchObject({ times: [1200], comparableRuns: 3, crews: 1 });
    const overlap = [["a", "b", "c", "d", "e"], ["c", "d", "e", "f", "g"], ["e", "f", "g", "h", "i"]];
    expect(calibrationSample(overlap.map((crew, i) => sample(i, { crew })))).toMatchObject({ crews: 1, times: [1800] });
  });
  it("does not mix game builds, unknown metadata or manual starts into calibration", () => {
    const result = calibrationSample([sample(0), sample(5, { build: "new" }), sample(10, { build: null }), sample(15, { startTrigger: "manual" }), sample(20, { crew: ["a"] })]);
    expect(result).toMatchObject({ build: "new", comparableRuns: 1, excludedRuns: 4, ready: false });
  });
});
