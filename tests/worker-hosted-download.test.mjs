/* global Blob, Request */
import { describe, expect, it } from "vitest";
import { hostedDownload } from "../worker/index.mjs";

// A KV stand-in: JSON values, and pieces read back as streams.
function kv(entries) {
  return {
    async get(key, type) {
      if (!(key in entries)) return null;
      const value = entries[key];
      if (type === "json") return JSON.parse(value);
      if (type === "stream") return new Blob([value]).stream();
      return value;
    }
  };
}
const bytes = (text) => new TextEncoder().encode(text);
const manifest = { name: "Guilded.Companion.Setup.9.0.4.exe", version: "9.0.4", size: 11, sha256: "a".repeat(64), chunks: 3, chunkKey: "downloads/Guilded.Companion.Setup.9.0.4.exe" };
const store = {
  "downloads/Guilded.Companion.Setup.exe": JSON.stringify(manifest),
  "downloads/Guilded.Companion.Setup.9.0.4.exe": JSON.stringify(manifest),
  "downloads/Guilded.Companion.Setup.9.0.4.exe#0": bytes("hell"),
  "downloads/Guilded.Companion.Setup.9.0.4.exe#1": bytes("o wo"),
  "downloads/Guilded.Companion.Setup.9.0.4.exe#2": bytes("rld")
};
const get = (path, method = "GET", entries = store) => hostedDownload(new Request(`https://guilded.kcaron.top${path}`, { method }), { OWNER_RESOURCES: kv(entries) }, { waitUntil() {} });

describe("companion installer served from KV (GitHub downloads timed out, 8 Nov 2026)", () => {
  it("joins the pieces in order with the size, file name and checksum", async () => {
    const response = await get("/downloads/Guilded.Companion.Setup.exe");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");
    expect(response.headers.get("content-length")).toBe("11");
    expect(response.headers.get("content-disposition")).toContain("Guilded.Companion.Setup.9.0.4.exe");
    expect(response.headers.get("x-sha256")).toBe("a".repeat(64));
  });
  it("answers HEAD without a body and serves the versioned name too", async () => {
    const head = await get("/downloads/Guilded.Companion.Setup.9.0.4.exe", "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });
  it("falls back to the GitHub release when nothing is stored, and ignores other paths", async () => {
    const missing = await get("/downloads/Guilded.Companion.Setup.exe", "GET", {});
    expect(missing.status).toBe(302);
    expect(missing.headers.get("location")).toContain("github.com/kevincaron28/Guilded/releases/latest");
    expect(await get("/downloads/Guilded-v9.0.4-forever.zip")).toBeNull();
    expect(await get("/downloads/../secret.exe")).toBeNull();
  });
  it("refuses writes", async () => {
    expect((await get("/downloads/Guilded.Companion.Setup.exe", "POST")).status).toBe(405);
  });
});
