import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, describeError, pairAccount, testConnection, validateConfig } from "../companion/engine.mjs";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function gameFolder() {
  const root = mkdtempSync(join(tmpdir(), "qg-engine-"));
  dirs.push(root);
  const saved = join(root, "WTF", "Account", "ACC", "SavedVariables");
  mkdirSync(saved, { recursive: true });
  mkdirSync(join(root, "Interface", "AddOns", "Guilded"), { recursive: true });
  return { root, file: join(saved, "Guilded.lua"), standings: join(root, "Interface", "AddOns", "Guilded", "Standings.lua") };
}

const config = (file: string) => ({ watchFile: file, realm: "R", uploadUrl: "http://bot.test/api/v1/addon-imports", guildDiscordId: "123", uploadToken: "x".repeat(32) });

describe("companion engine", () => {
  it("lists what is missing from a config", () => {
    expect(validateConfig({})).toHaveLength(4);
    expect(validateConfig(config("a.lua"))).toEqual([]);
    expect(validateConfig({ ...config("a.lua"), uploadToken: "short" })[0]).toContain("token");
  });

  it("explains a network failure in plain words", () => {
    expect(describeError(new TypeError("fetch failed"))).toContain("Could not reach the bot");
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("tests a connection: ok, refused token, unreachable", async () => {
    const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body }));
    answer(200, { standings: [1, 2] });
    expect((await testConnection(config("a.lua"))).message).toContain("2 character");
    answer(401, { error: "no" });
    expect((await testConnection(config("a.lua"))).message).toContain("refused the token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect((await testConnection(config("a.lua"))).ok).toBe(false);
  });

  it("exchanges a pairing code for a companion credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ companionCredential: "c".repeat(43) })
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await pairAccount({ ...config("a.lua"), pairingCode: "A1B2C3D4E5F6" });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://bot.test/api/v1/addon-pairings"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ guildDiscordId: "123", code: "A1B2C3D4E5F6" })
      })
    );
  });

  it("writes standings when it starts and reports state and log lines", async () => {
    const game = gameFolder();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ updatedAt: "2026-09-26T00:00:00Z", baseGp: 0, acceptedRunRefs: [], standings: [{ character: "Kev", ep: 10, gp: 5, main: true }] })
    }));
    const logs: string[] = [];
    let last: { running: boolean; lastStandings: { message: string } | null } | undefined;
    const engine = createEngine(config(game.file), { onLog: (e: { message: string }) => logs.push(e.message), onState: (s: typeof last) => { last = s; } });
    expect(await engine.start()).toBe(true);
    expect(readFileSync(game.standings, "utf8")).toContain('name = "Kev"');
    expect(last?.running).toBe(true);
    expect(last?.lastStandings?.message).toContain("1 character");
    await engine.stop();
    expect(engine.state().running).toBe(false);
  });

  it("does not start with an incomplete config or a missing folder", async () => {
    const engine = createEngine({ ...config("Z:/nope/WTF/Guilded.lua") }, {});
    expect(await engine.start()).toBe(false);
    expect(engine.state().lastError?.message).toContain("does not exist");
    const bare = createEngine({}, {});
    expect(await bare.start()).toBe(false);
  });

  it("uploads when the saved file changes", async () => {
    const game = gameFolder();
    writeFileSync(game.file, 'GuildedDB = { version = 1 }\n');
    const fetchMock = vi.fn().mockImplementation(async (url: URL | string) => String(url).includes("standings")
      ? { ok: true, status: 200, json: async () => ({ updatedAt: "x", baseGp: 0, standings: [] }) }
      : { ok: true, status: 200, json: async () => ({ transactionCount: 0, importId: "i1", autoApplied: { epgp: 0, discovered: 0 } }) });
    vi.stubGlobal("fetch", fetchMock);
    const engine = createEngine({ ...config(game.file), companionCredential: "paired-secret" }, {});
    await engine.start();
    engine.uploadNow();
    await vi.waitFor(() => expect(engine.state().uploads + (engine.state().lastError ? 1 : 0)).toBeGreaterThan(0), { timeout: 3000 });
    const upload = fetchMock.mock.calls.find(([url]) => String(url).includes("addon-imports"));
    expect(upload?.[1]?.headers["x-companion-credential"]).toBe("paired-secret");
    await engine.stop();
  });
});
