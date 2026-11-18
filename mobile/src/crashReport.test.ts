import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { buildReport, currentReportScreen, sendErrorReport, setReportScreen } from "./crashReport";

afterEach(() => vi.unstubAllGlobals());

describe("error report", () => {
  it("keeps the error, a short stack, the version and the screen, and removes links and paths", () => {
    const error = new TypeError("Cannot read x at https://guildedwow.com/api?token=abc");
    error.stack = ["TypeError: boom", ...Array.from({ length: 20 }, (_, i) => `    at fn${i} (C:\\Users\\Kev\\app\\file${i}.js:1:2)`)].join("\n");
    const report = buildReport(error, { version: "0.4.0", platform: "android", screen: "stats" });
    expect(report.message).toBe("TypeError: Cannot read x at [link]");
    expect(report.stack.split("\n")).toHaveLength(8);
    expect(report.stack).not.toMatch(/Kev|C:/);
    expect(report).toMatchObject({ version: "0.4.0", platform: "android", screen: "stats" });
  });
  it("handles strings, unknown errors and odd platforms", () => {
    expect(buildReport("plain text", { platform: "ios" })).toMatchObject({ message: "plain text", version: "unknown", platform: "ios", screen: "" });
    expect(buildReport({ weird: true }, { platform: "windows" }).message).toBe("Unknown error");
    expect(buildReport({}, { platform: "windows" }).platform).toBe("android");
    expect(buildReport(new Error("x".repeat(1000)), { platform: "web" }).message).toHaveLength(400);
  });
  it("remembers the screen", () => {
    setReportScreen("news");
    expect(currentReportScreen()).toBe("news");
  });
  it("posts the report and returns the reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ref: "K3X9QZ2A" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = buildReport(new Error("boom"), { version: "0.4.0", platform: "android" });
    expect(await sendErrorReport("https://guildedwow.com", report)).toBe("K3X9QZ2A");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://guildedwow.com/api/v1/mobile/report");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(report);
    expect(JSON.stringify(init.headers)).not.toMatch(/credential|authorization/i);
  });
  it("fails when the server refuses or answers without a reference", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "Too many" }), { status: 429 })));
    await expect(sendErrorReport("https://guildedwow.com", buildReport("x", { platform: "android" }))).rejects.toBeInstanceOf(ApiError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(sendErrorReport("https://guildedwow.com", buildReport("x", { platform: "android" }))).rejects.toThrow(/could not be sent/);
  });
});
