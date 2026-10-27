import { describe, expect, it, vi } from "vitest";
import { approvedDiagnosticFields, automaticDiagnostic, installDiagnosticConsole, redactDiagnosticText } from "../src/services/diagnostic-privacy.js";

describe("diagnostic privacy", () => {
  it("removes configured secrets even without a credential label", () => {
    vi.stubEnv("DIAGNOSTIC_TEST_TOKEN","not-labelled-sensitive-value");
    try { expect(redactDiagnosticText("Failure not-labelled-sensitive-value")).toBe("Failure [redacted]"); }
    finally { vi.unstubAllEnvs(); }
  });
  it("redacts credentials, encoded secrets, URLs, paths and payloads before truncation", () => {
    const secret="a/private&token=secret123";
    const input=[secret,encodeURIComponent(secret),"Authorization: Bearer abc123", "Cookie: session=abcdef",
      '"access_token":"unknown-value"', "password='private words'", "sessionId=session-private",
      "https://host.invalid/private?signature=secret", "postgresql://user:pass@host/db", "https%3A%2F%2Fhost.invalid%2Fprivate",
      "C:\\Users\\PrivateName\\secret.log", "/home/private/.config", "@everyone <@123456789012345678>",
      "-----BEGIN PRIVATE KEY-----\nprivate-pem\n-----END PRIVATE KEY-----", 'payload={"private chat":"not-for-logs"}'].join("\n");
    const redacted=redactDiagnosticText(input,10000,[secret]);
    for(const denied of [secret,"unknown-value","private words","session-private","host.invalid","PrivateName","private-pem","not-for-logs","@everyone"]) expect(redacted).not.toContain(denied);
    expect(redactDiagnosticText(`token=${"x".repeat(10000)}`,50,[])).toBe("credential=[redacted]");
    expect(redactDiagnosticText({private:"payload"})).toBe("[non-text diagnostic omitted]");
  });
  it("automatic diagnostics keep class, approved code and basename frames, never exception text or objects", () => {
    const error=Object.assign(new TypeError("private chat and token=SECRET"),{code:"P2002",request:{token:"SECRET"}});
    error.stack="TypeError: private chat\n    at handler (C:\\Users\\private\\app.ts:42:3)\n    at http (https://host.invalid/app.js?token=SECRET:1:2)";
    const detail=automaticDiagnostic(error);
    expect(detail.message).toMatch(/^TypeError code=P2002 \[error:[a-f0-9]{12}\]$/);
    expect(detail.stack).toBe("app.ts:42:3");
    expect(JSON.stringify(detail)).not.toMatch(/private|SECRET|host.invalid/);
    expect(automaticDiagnostic({token:"SECRET"}).message).toMatch(/^UnknownError/);
  });
  it("only allows bounded edition/build/capability identifiers", () => {
    expect(approvedDiagnosticFields({edition:"forever",build:70532,interface:16001,routeId:3065,encounterId:3496,
      addonVersion:"7.5.1",event:"BOSS_KILL",capability:"native",chat:"private",token:"secret",sessionId:"123",url:"https://secret"}))
      .toEqual({addonVersion:"7.5.1",build:70532,interface:16001,routeId:3065,encounterId:3496,edition:"forever",event:"BOSS_KILL",capability:"native"});
    expect(approvedDiagnosticFields({build:Infinity,edition:"secret",event:"private chat",addonVersion:"token=secret"})).toEqual({});
  });
  it("console errors and warnings cannot serialize raw strings, objects or exception payloads", () => {
    const error=vi.fn(),warn=vi.fn(),target={error,warn};
    const restore=installDiagnosticConsole(target);
    target.error("private chat without labels",{secret:"private object"},new Error("private exception"));
    target.warn("https://secret.invalid");
    expect(JSON.stringify([error.mock.calls,warn.mock.calls])).not.toMatch(/private chat|private object|private exception|secret.invalid/);
    expect(error.mock.calls[0]![0]).toMatch(/^\[diagnostic:/);
    restore();expect(target.error).toBe(error);
  });
});
