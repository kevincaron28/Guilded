import { beforeEach, describe, expect, it } from "vitest";
import { clientAddress, isLockedOut, recordFailure, resetFailures } from "../src/companion-api.js";

describe("companion API failed-login throttle", () => {
  beforeEach(() => resetFailures());

  it("locks an address out after 10 failures, for the length of the window", () => {
    const start = 1_000_000;
    for (let i = 0; i < 9; i++) recordFailure("1.2.3.4", start + i);
    expect(isLockedOut("1.2.3.4", start + 100)).toBe(false);
    recordFailure("1.2.3.4", start + 200);
    expect(isLockedOut("1.2.3.4", start + 300)).toBe(true);
    expect(isLockedOut("5.6.7.8", start + 300)).toBe(false);
    // Ten minutes later the failures have aged out.
    expect(isLockedOut("1.2.3.4", start + 10 * 60_000 + 500)).toBe(false);
  });

  it("uses the first x-forwarded-for address when the direct peer is the trusted loopback proxy", () => {
    const request = (headers: Record<string, string>, remote = "127.0.0.1") => ({ headers, socket: { remoteAddress: remote } }) as never;
    expect(clientAddress(request({ "x-forwarded-for": "9.9.9.9, 127.0.0.1" }))).toBe("9.9.9.9");
    expect(clientAddress(request({}))).toBe("127.0.0.1");
  });

  it("ignores a self-reported x-forwarded-for from a direct, non-loopback peer", () => {
    // A client connecting straight to the API (no trusted reverse proxy in between) cannot
    // pick its own throttle key by forging the header; its real socket address is used instead.
    const request = (headers: Record<string, string>, remote: string) => ({ headers, socket: { remoteAddress: remote } }) as never;
    expect(clientAddress(request({ "x-forwarded-for": "9.9.9.9" }, "6.6.6.6"))).toBe("6.6.6.6");
  });

  it("evicts the oldest tracked address once the cap is reached, instead of growing without bound", () => {
    resetFailures();
    for (let i = 0; i < 9; i++) recordFailure("addr-0", 1_000_000 + i); // 9 failures: not locked out yet
    for (let i = 1; i <= 5_000; i++) recordFailure(`addr-${i}`, 1_000_100); // fills the 5,000-address cap, evicting addr-0
    // If addr-0 had been evicted, this is its failure #1 again (not locked out).
    // If the map had grown unbounded instead, this would be failure #10 (locked out).
    recordFailure("addr-0", 1_000_200);
    expect(isLockedOut("addr-0", 1_000_300)).toBe(false);
  });
});
