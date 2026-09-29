import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine } from "../companion/engine.mjs";
import { checkUrl } from "../companion/request.mjs";
const folders: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "guilded-retry-")); folders.push(dir);
  const saved = join(dir, "WTF", "Account", "A", "SavedVariables"); mkdirSync(saved, { recursive: true });
  mkdirSync(join(dir, "Interface", "AddOns", "Guilded"), { recursive: true });
  const watchFile = join(saved, "Guilded.lua"); writeFileSync(watchFile, 'GuildedDB={version=4,addonVersion="5.0.0"}');
  return { watchFile, realm: "R", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "123", companionCredential: "x".repeat(43) };
}
const standings = { ok: true, status: 200, json: async () => ({ protocolVersion: 2, botVersion: "5.0.0", updatedAt: "now", standings: [] }) };
const uploaded = { ok: true, status: 201, json: async () => ({ autoApplied: { epgp: 0, discovered: 0 }, botVersion: "5.0.0" }) };
describe("companion recovery", () => {
  it("rejects remote HTTP and URL credentials", () => {
    expect(() => checkUrl("http://remote.test")).toThrow("HTTPS");
    expect(() => checkUrl("https://user:password@remote.test")).toThrow("credentials");
    expect(() => checkUrl("http://127.0.0.1:8787")).not.toThrow();
  });
  it("uploads existing saved data on startup, retries transient failure, and stops all further retries", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("standings")) return standings;
      posts++;
      if (posts === 1) return { ok: false, status: 503, json: async () => ({}) };
      return uploaded;
    }));
    const engine = createEngine(fixture());
    try {
      await engine.start();
      await vi.waitFor(() => expect(engine.state().retryAt).toBeTruthy());
      // Exercise the retry path without sleeping through its backoff.
      engine.uploadNow();
      await vi.waitFor(() => expect(engine.state().uploads).toBe(1));
      expect(posts).toBe(2);
      expect(engine.state().uploadError).toBeNull();
      expect(engine.state().botVersion).toBe("5.0.0");
    } finally { await engine.stop(); }
    expect(engine.state().retryAt).toBeNull();
  });
  it("coalesces requests while one upload is in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("standings")) return standings;
      posts++; if (posts === 1) await gate; return uploaded;
    }));
    const engine = createEngine(fixture());
    try {
      await engine.start();
      await vi.waitFor(() => expect(posts).toBe(1));
      engine.uploadNow(); engine.uploadNow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(posts).toBe(1);
      release?.();
      await vi.waitFor(() => expect(posts).toBe(2));
    } finally { release?.(); await engine.stop(); }
  });
  it("does not retry revoked credentials automatically", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => String(url).includes("standings") ? standings : { ok: false, status: 401, json: async () => ({ error: "Pair again" }) }));
    const engine = createEngine(fixture());
    try {
      await engine.start();
      await vi.waitFor(() => expect(engine.state().uploadError).toContain("Pair again"));
      expect(engine.state().retryAt).toBeNull();
    } finally { await engine.stop(); }
  });
});
