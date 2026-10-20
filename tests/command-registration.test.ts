import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandRegistrationStatus } from "../src/services/command-registration.js";

describe("command registration status (/health)", () => {
  it("is pending until the startup registration finishes", () => {
    const status = createCommandRegistrationStatus();
    expect(status.state()).toBe("pending");
    status.finish();
    expect(status.state()).toBe("pending");
    status.start();
    status.finish();
    expect(status.state()).toBe("ok");
  });

  it("stays failed when any server refused the list, and keeps the reason for the logs only", () => {
    const status = createCommandRegistrationStatus();
    status.start();
    status.failed("123456789012345678", new Error("Invalid Form Body: description must be 100 or fewer in length"));
    status.finish();
    expect(status.state()).toBe("failed");
    expect(status.failures().get("123456789012345678")).toContain("100 or fewer");
  });

  it("starts over on the next registration", () => {
    const status = createCommandRegistrationStatus();
    status.start();
    status.failed("1", "boom");
    status.start();
    status.finish();
    expect(status.state()).toBe("ok");
    expect(status.failures().size).toBe(0);
  });
});

describe("deploy/update.sh", () => {
  const update = readFileSync(resolve("deploy/update.sh"), "utf8").replace(/\r\n/g, "\n");
  const script = update.match(/node -e '([^']+)'/)?.[1] ?? "";
  const read = (body: string) => execFileSync(process.execPath, ["-e", script], { input: body, encoding: "utf8" });

  // Four short node processes: give them room when the whole suite runs in parallel on Windows.
  it("reads the commands state from /health, and copes with older bots and bad answers", () => {
    expect(script).not.toBe("");
    expect(read(JSON.stringify({ ok: true, botVersion: "7.2.1", commands: "failed" }))).toBe("failed");
    expect(read(JSON.stringify({ ok: true, botVersion: "7.2.1", commands: "ok" }))).toBe("ok");
    expect(read(JSON.stringify({ ok: true, botVersion: "7.2.0" }))).toBe("unknown");
    expect(read("<html>502</html>")).toBe("unknown");
  }, 60_000);

  it("stops with an error when Discord refused the commands or never answered", () => {
    expect(update).toMatch(/failed\)[\s\S]*?exit 2 ;;/);
    expect(update).toMatch(/pending\)[\s\S]*?exit 2 ;;/);
  });
});
