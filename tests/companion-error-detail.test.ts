import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { describeError, SERVER_TIMEOUT } from "../companion/engine.mjs";
import { endpointHost, errorDetail, isTimeout, rememberError } from "../companion/error-detail.mjs";
import { syncDiagnosticPreview } from "../companion/sync-status.mjs";
import { problemReport } from "../companion/problems.mjs";

// 8.5 second-PC test: the support summary had companionVersion null and no error details, and a
// slow answer read as "Could not reach the bot".
const fr = createRequire(import.meta.url)("../companion-app/locales/fr.json") as Record<string, string>;
const identity = createRequire(import.meta.url)("../companion-app/link-identity.cjs");
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:443"), { code: "ECONNREFUSED" }) });

describe("timeout wording", () => {
  it("a timeout says the server took too long, not that it could not be reached", () => {
    expect(describeError(timeout())).toBe("The Guilded server took too long to answer (over 20 s); retrying.");
    expect(describeError(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT", name: "HeadersTimeoutError" } }))).toBe(SERVER_TIMEOUT);
    expect(describeError(refused())).toBe("Could not reach the bot. Is it running, and is the bot address right?");
    expect(isTimeout(refused())).toBe(false);
  });
  it("is French, and counts as Guilded's side (amber, retried)", () => {
    expect(fr[SERVER_TIMEOUT]).toBeTypeOf("string");
    expect(identity.companionHealth({ state: { running: true, uploadError: SERVER_TIMEOUT } })).toMatchObject({ level: "setup", serverSide: true });
  });
});

describe("error details for the support summary", () => {
  const url = "https://guilded.kcaron.top/api/v1/addon-imports?token=secret";
  it("records operation, host, status, cause code and name, and the duration", () => {
    const now = Date.parse("2026-11-06T20:00:20Z");
    expect(errorDetail("standings", timeout(), { startedAt: now - 20_012, uploadUrl: url, now }))
      .toEqual({ at: "2026-11-06T20:00:20.000Z", operation: "standings", host: "guilded.kcaron.top", status: null, code: null, name: "TimeoutError", timedOut: true, durationMs: 20_012 });
    expect(errorDetail("upload", refused(), { startedAt: now - 35, uploadUrl: url, now })).toMatchObject({ code: "ECONNREFUSED", name: "TypeError", status: null, timedOut: false, durationMs: 35 });
    expect(errorDetail("upload", Object.assign(new Error("Upload failed (503): The guild bot is temporarily unavailable."), { retryable: true }), { uploadUrl: url, now }))
      .toMatchObject({ status: 503, code: null, name: null, durationMs: null });
  });
  it("keeps only the host of the bot address, and the last five", () => {
    expect(endpointHost("https://user:pw@bot.example.org:8443/x?y=1")).toBe("bot.example.org");
    expect(endpointHost("not a url")).toBeNull();
    let list: unknown[] = [];
    for (let index = 0; index < 7; index++) list = rememberError(list, { n: index });
    expect(list).toEqual([2, 3, 4, 5, 6].map((n) => ({ n })));
  });
  it("the summary carries the companion version and the allowlisted errors only", () => {
    const now = Date.parse("2026-11-06T20:00:20Z");
    const recentErrors = [
      errorDetail("upload", refused(), { startedAt: now - 35, uploadUrl: url, now }),
      { at: "2026-11-06T20:01:00Z", operation: "standings", host: "evil/path?token=x", status: 999, code: "secret token", name: "Bearer abc", durationMs: -1, message: "Bearer secret", credential: "c" }
    ];
    const preview = syncDiagnosticPreview({ companionCredential: "very-private" }, { running: true, recentErrors }, { companionVersion: "8.4.7" });
    expect(preview.companionVersion).toBe("8.4.7");
    expect(preview.recentErrors).toEqual([
      { at: "2026-11-06T20:00:20.000Z", operation: "upload", host: "guilded.kcaron.top", status: null, code: "ECONNREFUSED", name: "TypeError", timedOut: false, durationMs: 35 },
      { at: "2026-11-06T20:01:00.000Z", operation: "standings", host: null, status: null, code: null, name: null, timedOut: false, durationMs: null }
    ]);
    const text = JSON.stringify(preview);
    for (const secret of ["secret", "Bearer", "very-private", "token", "credential"]) expect(text).not.toContain(secret);
    // The copied report (Problems page) uses the same allowlist.
    expect(problemReport({ state: { running: true, recentErrors }, companionVersion: "8.4.7", reference: "C-TEST" }).text).toContain("ECONNREFUSED");
  });
});
