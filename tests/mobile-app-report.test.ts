import { describe, expect, it } from "vitest";
import { MOBILE_REPORTS_PER_NETWORK_PER_HOUR, allowMobileReport, mobileReportText } from "../src/services/mobile-app-report.js";

describe("phone app error report", () => {
  it("builds one short text from a valid report", () => {
    const text = mobileReportText({ message: "Cannot read property 'x' of undefined", stack: "at Row (App.js:1:2)", version: "0.4.0", platform: "android", screen: "stats" });
    expect(text).toBe("Phone app 0.4.0 (android) · stats\nCannot read property 'x' of undefined\n\nat Row (App.js:1:2)");
  });
  it("accepts a message alone and strips control characters", () => {
    expect(mobileReportText({ message: "boom\u0000\u0007" })).toBe("Phone app unknown (android)\nboom");
  });
  it.each([null, "text", {}, { message: "" }, { message: "   " }, { message: "x".repeat(401) }, { message: "x", extra: 1 }, { message: "x", platform: "nokia" }])("rejects %j", (body) => {
    expect(mobileReportText(body)).toBeNull();
  });
  it("allows a few reports per network per hour, then refuses", () => {
    const now = Date.now();
    for (let i = 0; i < MOBILE_REPORTS_PER_NETWORK_PER_HOUR; i++) expect(allowMobileReport("203.0.113.9", now)).toBe(true);
    expect(allowMobileReport("203.0.113.9", now)).toBe(false);
    expect(allowMobileReport("203.0.113.10", now)).toBe(true);
    expect(allowMobileReport("203.0.113.9", now + 3_600_001)).toBe(true);
  });
});
