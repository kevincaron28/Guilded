import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAppliedUploads, isRepeatUpload, REPEAT_MEMORY_MS, rememberAppliedUpload, runUploadLanes, uploadRepeatKey, type UploadStep } from "../src/services/upload-repeat.js";

// 17 Nov 2026: 61% of uploads repeated the previous file and still ran every side-effect phase (p50 12 s of a 20 s companion limit).

beforeEach(() => forgetAppliedUploads());

describe("the repeated-upload memory", () => {
  const key = uploadRepeatKey("g", "u", false);

  it("knows only a payload the same uploader had fully applied, and only for ten minutes", () => {
    expect(isRepeatUpload(key, "c1", 1_000)).toBe(false);
    rememberAppliedUpload(key, "c1", 1_000);
    expect(isRepeatUpload(key, "c1", 2_000)).toBe(true);
    expect(isRepeatUpload(key, "c2", 2_000)).toBe(false);
    expect(isRepeatUpload(uploadRepeatKey("g", "other", false), "c1", 2_000)).toBe(false);
    expect(isRepeatUpload(uploadRepeatKey("g", "u", true), "c1", 2_000)).toBe(false);
    expect(isRepeatUpload(key, "c1", 1_000 + REPEAT_MEMORY_MS)).toBe(false);
  });

  it("is bounded", () => {
    for (let i = 0; i < 2_100; i++) rememberAppliedUpload(`k${i}`, "c", 1);
    expect(isRepeatUpload("k0", "c", 2)).toBe(false);
    expect(isRepeatUpload("k2099", "c", 2)).toBe(true);
  });
});

describe("the upload lanes", () => {
  const steps = () => {
    const calls: string[] = [];
    const step = (name: string, payload: boolean, extra: Partial<UploadStep> = {}): UploadStep => ({ name, payload, run: async () => { calls.push(name); }, ...extra });
    return { calls, lanes: [
      { name: "guild", steps: [step("guild-data", false), step("relay", true)] },
      { name: "bank", steps: [step("bank", true)] },
      { name: "board", steps: [step("map", true), step("pvp-events", true)] }
    ] };
  };

  it("a repeated payload runs only the steps that apply on every upload", async () => {
    const { calls, lanes } = steps();
    const result = await runUploadLanes(lanes, { repeat: true });
    expect(calls).toEqual(["guild-data"]);
    expect(result.skipped.sort()).toEqual(["bank", "map", "pvp-events", "relay"]);
    expect(result.failed).toBe(false);
  });

  it("a new payload runs everything, each lane in order, and the lanes at the same time", async () => {
    const order: string[] = [];
    const gate = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
    const lanes = [
      { name: "a", steps: [{ name: "a1", run: async () => { order.push("a1 start"); await gate(); order.push("a1 end"); } }, { name: "a2", run: async () => { order.push("a2"); } }] },
      { name: "b", steps: [{ name: "b1", run: async () => { order.push("b1 start"); await gate(); order.push("b1 end"); } }] }
    ];
    const started = Date.now();
    const result = await runUploadLanes(lanes, { repeat: false });
    expect(Date.now() - started).toBeLessThan(55); // two 30 ms steps in different lanes overlapped
    expect(order.indexOf("a1 end")).toBeLessThan(order.indexOf("a2"));
    expect(order.indexOf("b1 start")).toBeLessThan(order.indexOf("a1 end"));
    expect(result.ran.sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("a failing step is reported through its own handler, does not stop its lane or the others, and marks the run failed (so it is not remembered)", async () => {
    const onError = vi.fn();
    const after = vi.fn();
    const other = vi.fn();
    const result = await runUploadLanes([
      { name: "a", steps: [{ name: "bad", payload: true, run: async () => { throw new Error("db"); }, onError }, { name: "after", run: async () => { after(); } }] },
      { name: "b", steps: [{ name: "other", run: async () => { other(); } }] }
    ], { repeat: false });
    expect(onError).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalled();
    expect(other).toHaveBeenCalled();
    expect(result.failed).toBe(true);
  });

  it("wraps each lane with the tracker", async () => {
    const seen: string[] = [];
    await runUploadLanes([{ name: "x", steps: [{ name: "s", run: async () => undefined }] }], { repeat: false, track: async (lane, task) => { seen.push(lane); return task(); } });
    expect(seen).toEqual(["x"]);
  });
});
