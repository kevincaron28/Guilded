import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPoeEngine, poeJournalPath } from "../companion/poe-engine.mjs";
import { createEngine, validateConfig } from "../companion/engine.mjs";
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const folders: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
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
  it("runs the shared synthetic lifecycle through the desktop reader with CRLF", async () => {
    const config = fixture(); const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start();
      appendFileSync(config.poeLogFile, readFileSync(new URL('./fixtures/poe2/lifecycle.txt', import.meta.url), 'utf8').replace(/\r?\n/g, '\r\n'));
      await engine.pollNow();
      const visits = JSON.parse(fetchMock.mock.calls[0]![1].body).visits;
      expect(visits).toHaveLength(2); expect(visits[0].instanceRef).toBe(visits[1].instanceRef);
      expect(visits[1].endReason).toBe('INTERRUPTED');
      expect(readFileSync(poeJournalPath(config), 'utf8')).not.toMatch(/private fixture chat|slain|Vous/);
    } finally { await engine.stop(); }
  });
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
  it("recovers recent rotation events once, rejecting history and the saved boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 30, 11, 59));
    const config = fixture(); const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); appendFileSync(config.poeLogFile, map); await engine.pollNow();
      vi.setSystemTime(new Date(2026, 8, 30, 12, 4));
      renameSync(config.poeLogFile, `${config.poeLogFile}.old`);
      writeFileSync(config.poeLogFile, map + hideout.replace("12:05:00", "12:01:00") + map.replace("12:00:00", "12:02:00") + hideout.replace("12:05:00", "12:03:00"));
      utimesSync(config.poeLogFile, new Date(), new Date());
      await engine.pollNow(); await engine.pollNow();
      const visits = fetchMock.mock.calls.flatMap(call => JSON.parse(call[1].body).visits);
      expect(visits).toHaveLength(2);
      expect(visits[0].endReason).toBe("INTERRUPTED");
      expect(visits[1].startedAt).toBe(new Date(2026, 8, 30, 12, 2).toISOString());
    } finally { await engine.stop(); }
  });
  it("detects a same-file rewrite that grows beyond the old cursor after an empty opt-in", async () => {
    const config = fixture(); const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); appendFileSync(config.poeLogFile, map); await engine.pollNow();
      writeFileSync(config.poeLogFile, 'replacement history\n' + map + hideout);
      await engine.pollNow();
      expect(engine.state().currentArea).toBeNull();
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).visits).toEqual([expect.objectContaining({ endReason: "INTERRUPTED" })]);
    } finally { await engine.stop(); }
  });
  it.each(['old', 'large'])("does not replay a %s replacement file", async kind => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 30, 11, 59));
    const config = fixture(); const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); appendFileSync(config.poeLogFile, map); await engine.pollNow();
      vi.setSystemTime(new Date(2026, 8, 30, 12, 5));
      renameSync(config.poeLogFile, `${config.poeLogFile}.old`);
      writeFileSync(config.poeLogFile, map.replace('12:00:00', '12:02:00') + hideout + (kind === 'large' ? 'x'.repeat(1_048_576) + '\n' : ''));
      utimesSync(config.poeLogFile, new Date(), kind === 'old' ? new Date(2026, 8, 29) : new Date());
      await engine.pollNow();
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).visits).toEqual([expect.objectContaining({ endReason: 'INTERRUPTED' })]);
    } finally { await engine.stop(); }
  });
  it("stops at queue capacity without advancing past unread visits and resumes after upload", async () => {
    const config = fixture(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const first = createPoeEngine(config);
    await first.start(); appendFileSync(config.poeLogFile, map + hideout); await first.pollNow(); await first.stop();
    const file = poeJournalPath(config); const saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.pending = Array.from({ length: 9999 }, (_, i) => ({ ...saved.pending[0], runRef: i.toString(16).padStart(64, '0') }));
    writeFileSync(file, JSON.stringify(saved));
    const one = map.replace('12:00:00', '13:00:00') + hideout.replace('12:05:00', '13:05:00');
    const two = map.replace('12:00:00', '14:00:00') + hideout.replace('12:05:00', '14:05:00');
    appendFileSync(config.poeLogFile, one + two);
    const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); expect(engine.state().error).toContain('queue is full');
      expect(JSON.parse(readFileSync(file, 'utf8')).offset).toBe(Buffer.byteLength(map + hideout + one));
      await engine.pollNow(); expect(engine.state().error).toBeNull();
      expect(JSON.parse(readFileSync(file, 'utf8')).pending.at(-1).startedAt).toBe(new Date(2026, 8, 30, 14).toISOString());
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { await engine.stop(); }
  });
  it("skips oversized complete and split lines, preserving the following CRLF visits", async () => {
    const config = fixture(); const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start();
      const oversized = map.trimEnd().replace('seed 1', `seed ${'1'.repeat(9000)}`);
      appendFileSync(config.poeLogFile, oversized + '\r\n' + oversized);
      await engine.pollNow(); expect(engine.state().currentArea).toBeNull();
      appendFileSync(config.poeLogFile, '\r\n' + map.replace('\n', '\r\n') + hideout.replace('\n', '\r\n'));
      await engine.pollNow();
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).visits).toHaveLength(1);
      expect(engine.state().currentArea).toBeNull();
    } finally { await engine.stop(); }
  });
  it("catches up across chunks with a bounded poll and retains a split valid line", async () => {
    const config = fixture(); const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start();
      appendFileSync(config.poeLogFile, 'x'.repeat(262_100) + '\n' + map + 'x'.repeat(900_000) + '\n' + hideout);
      await engine.pollNow(); expect(engine.state().catchingUp).toBe(true);
      await engine.pollNow(); expect(engine.state().catchingUp).toBe(false);
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).visits).toHaveLength(1);
    } finally { await engine.stop(); }
  });
  it.each(["EACCES", "EPERM", "EBUSY"])("retries %s file access failures without dropping queued uploads", async code => {
    const config = fixture(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const first = createPoeEngine(config);
    await first.start(); appendFileSync(config.poeLogFile, map + hideout); await first.pollNow(); await first.stop();
    const fetchMock = successfulFetch(); const engine = createPoeEngine(config);
    vi.mocked(fsPromises.open).mockRejectedValueOnce(Object.assign(new Error("locked"), { code }));
    try {
      await engine.start(); expect(engine.state().error).toContain("locked");
      expect(fetchMock).toHaveBeenCalledTimes(1); expect(engine.state().pending).toBe(0);
      await engine.pollNow(); expect(engine.state().error).toBeNull();
    } finally { await engine.stop(); }
  });
  it("reports UTF-16 without advancing the cursor, then recovers when the original file returns", async () => {
    const config = fixture(); successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); const before = JSON.parse(readFileSync(poeJournalPath(config), 'utf8')).offset;
      writeFileSync(config.poeLogFile, Buffer.from('\ufeff' + map + hideout, 'utf16le'));
      await engine.pollNow(); expect(engine.state().error).toContain('UTF-16');
      expect(JSON.parse(readFileSync(poeJournalPath(config), 'utf8')).offset).toBe(before);
      writeFileSync(config.poeLogFile, map + hideout); await engine.pollNow();
      expect(engine.state().error).toBeNull(); expect(engine.state().lastActivity).not.toBeNull();
    } finally { await engine.stop(); }
  });
  it("warns on unrecognized activity without calling an idle file wrong, and clears after recognition", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 30, 12));
    const config = fixture(); successfulFetch(); const engine = createPoeEngine(config);
    try {
      await engine.start(); vi.setSystemTime(new Date(2026, 8, 30, 12, 10)); await engine.pollNow();
      expect(engine.state().warning).toBeNull();
      appendFileSync(config.poeLogFile, 'unrecognized log data\n'); await engine.pollNow();
      vi.setSystemTime(new Date(2026, 8, 30, 12, 16)); await engine.pollNow();
      expect(engine.state().warning).toContain('If you have changed areas');
      appendFileSync(config.poeLogFile, map); await engine.pollNow(); expect(engine.state().warning).toBeNull();
    } finally { await engine.stop(); }
  });
  it("persists today's distinct maps through upload/restart, excludes re-entries, and resets at midnight", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 30, 12, 20));
    const config = fixture(); successfulFetch(); const engine = createPoeEngine(config);
    await engine.start(); appendFileSync(config.poeLogFile, map + hideout + map.replace('12:00:00', '12:06:00'));
    await engine.pollNow();
    expect(engine.state().todayMaps).toBe(1); expect(engine.state().currentStartedAt).not.toBeNull();
    await engine.stop();
    const second = createPoeEngine(config);
    try {
      await second.start(); expect(second.state().todayMaps).toBe(1);
      appendFileSync(config.poeLogFile, map.replace('12:00:00', '12:10:00').replace('seed 1', 'seed 2'));
      await second.pollNow(); expect(second.state().todayMaps).toBe(2);
      vi.setSystemTime(new Date(2026, 9, 1)); await second.pollNow(); expect(second.state().todayMaps).toBe(0);
    } finally { await second.stop(); }
  });
});
