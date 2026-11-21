import { describe, expect, it } from "vitest";
import { parseRetryAfter, retryAfterOf, retryDelay, UPLOAD_TIMEOUT_MS, RETRY_MAX_MS } from "../companion/retry.mjs";
import { acceptedWithKnown, foldKnownRefs, knownRunRefs } from "../companion/known-runs.mjs";
import { mergeDeviceReceipts } from "../companion/device-receipts.mjs";
import { retryAfterSeconds } from "../src/companion-api.js";

describe("9.4 T1.3: upload retry timing", () => {
  it("backs off min(300 s, 5 s * 2^n) with at most 30% jitter either way", () => {
    for (const [failures, base] of [[0, 5_000], [1, 10_000], [3, 40_000], [6, 300_000], [20, 300_000]] as const) {
      expect(retryDelay(failures, { random: () => 0.5 })).toBe(base);
      expect(retryDelay(failures, { random: () => 0 })).toBe(Math.round(base * 0.7));
      expect(retryDelay(failures, { random: () => 1 })).toBe(Math.round(base * 1.3));
    }
  });
  it("spreads a herd: many failures at once give many different delays", () => {
    const delays = new Set(Array.from({ length: 50 }, () => retryDelay(2)));
    expect(delays.size).toBeGreaterThan(10);
  });
  it("honours Retry-After on 429 and 503 (seconds or a date), capped at five minutes", () => {
    const headers = (value: string) => ({ get: (name: string) => name === "retry-after" ? value : null });
    expect(retryAfterOf({ status: 503, headers: headers("30") })).toBe(30_000);
    expect(retryAfterOf({ status: 429, headers: headers("12") })).toBe(12_000);
    expect(retryAfterOf({ status: 500, headers: headers("30") })).toBeNull();
    expect(retryAfterOf({ status: 503, headers: { get: () => null } })).toBeNull();
    expect(parseRetryAfter("99999")).toBe(RETRY_MAX_MS);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:30 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(30_000);
    expect(parseRetryAfter("nonsense")).toBeNull();
    expect(retryDelay(4, { retryAfterMs: 30_000, random: () => 0 })).toBe(30_000);
    expect(retryDelay(4, { retryAfterMs: 0 })).toBe(1_000);
  });
  it("fails a stalled upload before the website proxy's 20 s cut-off", () => {
    expect(UPLOAD_TIMEOUT_MS).toBeLessThan(20_000);
    expect(UPLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
  });
  it("the bot answers 503 with a Retry-After of 15 to 45 seconds", () => {
    expect(retryAfterSeconds(() => 0)).toBe(15);
    expect(retryAfterSeconds(() => 0.999999)).toBe(45);
    for (let i = 0; i < 100; i++) { const value = retryAfterSeconds(); expect(value).toBeGreaterThanOrEqual(15); expect(value).toBeLessThanOrEqual(45); }
  });
});

describe("9.4 T1.6: the companion records known runs as accepted", () => {
  it("folds knownRunRefs into the accepted refs and ignores junk", () => {
    expect(acceptedWithKnown({ acceptedRunRefs: ["a"], knownRunRefs: ["b", 5, "", "a"] })).toEqual(["a", "b"]);
    expect(knownRunRefs({ knownRunRefs: "no" })).toEqual([]);
    expect(foldKnownRefs({ acceptedRunRefs: ["a"], knownRunRefs: ["b"] })).toMatchObject({ acceptedRunRefs: ["a", "b"] });
    const plain = { acceptedRunRefs: ["a"] };
    expect(foldKnownRefs(plain)).toBe(plain);
  });
  it("the device receipts keep them, so the next upload leaves them out", () => {
    const merged = mergeDeviceReceipts({ refs: ["old"], notes: {}, pending: {} }, { acceptedRunRefs: ["a"], knownRunRefs: ["b"] });
    expect(merged.refs).toEqual(["a", "b", "old"]);
  });
  it("an answer from an older bot (no knownRunRefs) behaves as before", () => {
    expect(mergeDeviceReceipts(undefined, { acceptedRunRefs: ["a"] }).refs).toEqual(["a"]);
  });
});
