import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPoeEngine, poeJournalPath } from "../companion/poe-engine.mjs";
import { createEngine, validateConfig } from "../companion/engine.mjs";
const folders: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "guilded-poe-")); folders.push(root);
  const poeLogFile = join(root, "Client.txt"); writeFileSync(poeLogFile, "");
  return { wowEnabled: false, poeEnabled: true, poeLogFile, poeCharacter: "Ann", poeLeague: "Pilot", poeMode: "STANDARD", poeJournalFile: join(root, "poe-journal.json"), uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "123", companionCredential: "x".repeat(43) };
}
const map = '2026/09/30 12:00:00 123456 2caa1afc [DEBUG Client 123] Generating level 80 area "MapSteppe" with seed 1\n';
const hideout = '2026/09/30 12:05:00 123789 2caa1afc [DEBUG Client 123] Generating level 60 area "HideoutFelled" with seed 1\n';
function successfulFetch() {
  const mock = vi.fn(async (_url: unknown, options: { body: string }) => ({ ok: true, status: 200, json: async () => ({ botVersion: "5.0.0", acceptedRunRefs: JSON.parse(options.body).visits.map((row: { runRef: string }) => row.runRef) }) }));
  vi.stubGlobal("fetch", mock); return mock;
}
describe("PoE2 companion capture and recovery", () => {
  it("works without a WoW installation and keeps PoE2 opt-in off by default", async () => {
    expect(validateConfig({ ...fixture(), poeEnabled: false })[0]).toContain("Enable WoW or PoE2");
    const config = fixture(); expect(validateConfig(config)).toEqual([]);
    const engine = createEngine(config);
    try { expect(await engine.start()).toBe(true); expect(engine.state().poe?.running).toBe(true); } finally { await engine.stop(); }
  });
  it("skips old history, waits for complete lines and never uploads or persists chat", async () => {
    const config = fixture(); writeFileSync(config.poeLogFile, map + hideout);
    const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); expect(fetchMock).not.toHaveBeenCalled();
      const freshMap = map.replace("12:00:00", "13:00:00");
      appendFileSync(config.poeLogFile, freshMap.slice(0, 40)); await engine.pollNow(); expect(engine.state().currentArea).toBeNull();
      appendFileSync(config.poeLogFile, freshMap.slice(40) + "private chat\n" + hideout.replace("12:05:00", "13:05:00")); await engine.pollNow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(engine.state().botVersion).toBe("5.0.0");
      const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(request.visits[0]).toMatchObject({ areaId: "MapSteppe", character: "Ann", league: "Pilot" });
      expect(JSON.stringify(request)).not.toContain("private chat");
      expect(readFileSync(poeJournalPath(config), "utf8")).not.toContain("private chat");
    } finally { await engine.stop(); }
  });
  it("persists an offline queue and replays the same reference after restart", async () => {
    const config = fixture(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const first = createPoeEngine(config);
    await first.start(); appendFileSync(config.poeLogFile, map + hideout); await first.pollNow();
    expect(first.state().pending).toBe(1); await first.stop();
    const queuedRef = JSON.parse(readFileSync(poeJournalPath(config), "utf8")).pending[0].runRef;
    const fetchMock = successfulFetch(); const second = createPoeEngine(config);
    try { await second.start(); expect(second.state().pending).toBe(0); expect(JSON.parse(fetchMock.mock.calls[0]![1].body).visits[0].runRef).toBe(queuedRef); } finally { await second.stop(); }
  });
  it("still uploads a queue saved before map instances were recorded", async () => {
    const config = fixture(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const first = createPoeEngine(config);
    await first.start(); appendFileSync(config.poeLogFile, map + hideout); await first.pollNow(); await first.stop();
    const file = poeJournalPath(config); const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.pending[0].instanceRef).toMatch(/^[a-f0-9]{64}$/);
    delete saved.pending[0].instanceRef; writeFileSync(file, JSON.stringify(saved));
    const fetchMock = successfulFetch(); const second = createPoeEngine(config);
    try { await second.start(); expect(second.state().pending).toBe(0); expect(JSON.parse(fetchMock.mock.calls[0]![1].body).visits[0]).not.toHaveProperty("instanceRef"); } finally { await second.stop(); }
  });
  it("stops retries for revoked credentials while retaining observations", async () => {
    const config = fixture(); const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })); vi.stubGlobal("fetch", fetchMock);
    const engine = createPoeEngine(config);
    try {
      await engine.start(); appendFileSync(config.poeLogFile, map + hideout); await engine.pollNow(); await engine.pollNow();
      expect(fetchMock).toHaveBeenCalledTimes(1); expect(engine.state().pending).toBe(1);
      expect(engine.state().error).toContain("Pair"); expect(engine.state().retryAt).toBeNull();
    } finally { await engine.stop(); }
  });
  it("continues capture during an outage and can drain a queue when the log is missing", async () => {
    const config = fixture(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const first = createPoeEngine(config);
    await first.start(); appendFileSync(config.poeLogFile, map + hideout); await first.pollNow();
    appendFileSync(config.poeLogFile, map.replace("12:00:00", "13:00:00") + hideout.replace("12:05:00", "13:05:00")); await first.pollNow();
    expect(first.state().pending).toBe(2); await first.stop(); rmSync(config.poeLogFile);
    const fetchMock = successfulFetch(); const second = createPoeEngine(config);
    try {
      await second.start(); expect(second.state().pending).toBe(0); expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.state().error).toContain("missing");
    } finally { await second.stop(); }
  });
  it("preserves a corrupt journal and refuses to overwrite it", async () => {
    const config = fixture(); const file = poeJournalPath(config);
    for (const corrupt of ["broken journal", '{"version":1}', '{"version":1,"pending":null}']) {
      writeFileSync(file, corrupt); const engine = createPoeEngine(config);
      expect(await engine.start()).toBe(false); expect(engine.state().error).toContain("recovery");
      expect(readFileSync(file, "utf8")).toBe(corrupt);
    }
  });
  it("keeps queues separate on guild/account/character/league changes", () => {
    const config = fixture(); const file = poeJournalPath(config);
    for (const change of [{ guildDiscordId: "456" }, { companionCredential: "y".repeat(43) }, { poeCharacter: "Bob" }, { poeLeague: "Different" }, { poeMode: "HARDCORE" }]) expect(poeJournalPath({ ...config, ...change })).not.toBe(file);
  });
  it("handles log truncation as an interruption and skips replacement history", async () => {
    const config = fixture(); const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); appendFileSync(config.poeLogFile, map); await engine.pollNow();
      expect(engine.state().currentArea).toBe("MapSteppe");
      writeFileSync(config.poeLogFile, "replacement\n"); await engine.pollNow();
      expect(engine.state().currentArea).toBeNull();
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).visits[0].endReason).toBe("INTERRUPTED");
      appendFileSync(config.poeLogFile, map.replace("12:00:00", "14:00:00") + hideout.replace("12:05:00", "14:05:00")); await engine.pollNow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { await engine.stop(); }
  });
  it("coalesces polls, cancels an upload on stop and retains its queue", async () => {
    const config = fixture(); let inFlight = 0;
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      inFlight++; options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    const engine = createPoeEngine(config); await engine.start(); appendFileSync(config.poeLogFile, map + hideout);
    const one = engine.pollNow(); const two = engine.pollNow();
    await vi.waitFor(() => expect(inFlight).toBe(1)); await engine.stop(); await Promise.all([one, two]);
    expect(engine.state().pending).toBe(1); expect(engine.state().running).toBe(false);
  });
});
