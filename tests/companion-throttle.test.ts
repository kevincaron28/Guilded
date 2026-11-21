import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_LIMITS, networkKey, windowLimiter } from "../src/services/companion-device.js";
import { clientAddress, isLockedOut, recordFailure, resetFailures, wellFormedCredential } from "../src/companion-api.js";

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

  describe("real client address from the Worker (x-guilded-client-ip)", () => {
    const request = (headers: Record<string, string>, remote = "127.0.0.1") => ({ headers, socket: { remoteAddress: remote } }) as never;
    const original = process.env["GUILDED_ORIGIN_TOKEN"];
    afterEach(() => { if (original === undefined) delete process.env["GUILDED_ORIGIN_TOKEN"]; else process.env["GUILDED_ORIGIN_TOKEN"] = original; });

    it("trusts the header only with a matching origin token from a loopback peer", () => {
      process.env["GUILDED_ORIGIN_TOKEN"] = "origin-secret-token";
      const good = { "x-guilded-client-ip": "203.0.113.7", "x-guilded-origin": "origin-secret-token", "x-forwarded-for": "10.0.0.1" };
      expect(clientAddress(request(good))).toBe("203.0.113.7");
      expect(clientAddress(request({ ...good, "x-guilded-origin": "wrong-secret-token!" }))).toBe("10.0.0.1");
      expect(clientAddress(request({ ...good, "x-guilded-origin": "short" }))).toBe("10.0.0.1");
      expect(clientAddress(request({ "x-guilded-client-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }))).toBe("10.0.0.1");
      expect(clientAddress(request(good, "6.6.6.6"))).toBe("6.6.6.6");
    });

    it("ignores the header when no origin token is configured", () => {
      delete process.env["GUILDED_ORIGIN_TOKEN"];
      expect(clientAddress(request({ "x-guilded-client-ip": "203.0.113.7", "x-guilded-origin": "", "x-forwarded-for": "10.0.0.1" }))).toBe("10.0.0.1");
    });

    it("does not share lockout or per-IP limits between two client addresses", () => {
      process.env["GUILDED_ORIGIN_TOKEN"] = "origin-secret-token";
      const viaWorker = (ip: string) => clientAddress(request({ "x-guilded-client-ip": ip, "x-guilded-origin": "origin-secret-token" }));
      const a = viaWorker("203.0.113.7");
      const b = viaWorker("198.51.100.9");
      expect(a).not.toBe(b);
      for (let i = 0; i < 10; i++) recordFailure(a, 1_000_000 + i);
      expect(isLockedOut(a, 1_000_100)).toBe(true);
      expect(isLockedOut(b, 1_000_100)).toBe(false);
      const regs = windowLimiter(DEVICE_LIMITS.registrationsPerIpPerHour, 3_600_000);
      for (let i = 0; i < DEVICE_LIMITS.registrationsPerIpPerHour; i++) regs(networkKey(a));
      expect(regs(networkKey(a))).toBe(false);
      expect(regs(networkKey(b))).toBe(true);
      const uploads = windowLimiter(DEVICE_LIMITS.uploadsPerIpPerHour, 3_600_000);
      for (let i = 0; i < DEVICE_LIMITS.uploadsPerIpPerHour; i++) uploads(networkKey(a));
      expect(uploads(networkKey(a))).toBe(false);
      expect(uploads(networkKey(b))).toBe(true);
    });
  });

  it("only well-formed credentials count towards a lockout", () => {
    expect(wellFormedCredential(undefined)).toBe(false);
    expect(wellFormedCredential("")).toBe(false);
    expect(wellFormedCredential("a b c d e f g h")).toBe(false);
    expect(wellFormedCredential("x".repeat(40))).toBe(true);
  });
});
