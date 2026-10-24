import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { acknowledgements, pruneAcknowledged, pruneOldRaids } from "../companion/delta.mjs";
import { guardedStandings, writeDataAddon } from "../companion/data-addon.mjs";
import { standingsToLua } from "../companion/standings.mjs";
import { createEngine } from "../companion/engine.mjs";
import { newLuaSession } from "./lua/harness.js";

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function gameFolder(withToc = true) {
  const root = mkdtempSync(join(tmpdir(), "qg-speed-")); dirs.push(root);
  const saved = join(root, "WTF", "Account", "ACC", "SavedVariables"); mkdirSync(saved, { recursive: true });
  const addon = join(root, "Interface", "AddOns", "Guilded"); mkdirSync(addon, { recursive: true });
  if (withToc) writeFileSync(join(addon, "Guilded.toc"), "## Interface: 16001, 20506\n## Title: Guilded\nCore.lua\n");
  return { root, file: join(saved, "Guilded.lua"), standings: join(addon, "Standings.lua"), data: join(root, "Interface", "AddOns", "GuildedData") };
}

const exported = {
  epgpTransactions: [
    { character: "Kev", sourceRef: "qg:Kev-1-1", epAmount: 10 },
    { character: "Kev", sourceRef: "qg:Kev-1-2", epAmount: 5, voided: true },
    { character: "Kev", sourceRef: "qg:Kev-1-3", epAmount: 7, voided: true },
    { character: "Kev", sourceRef: "qg:Kev-1-4", epAmount: 1 }
  ],
  loot: [{ ref: "qg-loot:1", item: "Sword" }, { ref: "qg-loot:2", item: "Shield" }],
  raids: [{ ref: "r1" }]
};

describe("companion delta uploads", () => {
  it("leaves out what the bot stored, but keeps voids until the reversal is acknowledged", () => {
    const ack = acknowledgements({
      acceptedLedgerRefs: ["addon:qg:Kev-1-1", "addon:qg:Kev-1-2", "addon:qg:Kev-1-3", "void:addon:qg:Kev-1-3"],
      acceptedLootRefs: ["qg-loot:1"]
    });
    const { exported: pruned, omitted } = pruneAcknowledged(exported, ack);
    expect(pruned.epgpTransactions.map((row: { sourceRef: string }) => row.sourceRef)).toEqual(["qg:Kev-1-2", "qg:Kev-1-4"]);
    expect(pruned.loot.map((row: { ref: string }) => row.ref)).toEqual(["qg-loot:2"]);
    expect(pruned.raids).toEqual(exported.raids);
    expect(omitted).toEqual({ ledger: 2, loot: 1, raids: 0 });
  });

  it("sends everything when nothing is acknowledged yet", () => {
    expect(pruneAcknowledged(exported, null).exported).toBe(exported);
    expect(pruneAcknowledged(exported, acknowledgements({})).exported.epgpTransactions).toHaveLength(4);
  });

  it("negotiates ledger and loot deltas independently", () => {
    const ack = acknowledgements({ acceptedLedgerRefs: ["addon:qg:Kev-1-1"], acceptedLootRefs: ["qg-loot:1"] });
    const ledgerOnly = pruneAcknowledged(exported, ack, new Set(["ledger-delta"]));
    expect(ledgerOnly.omitted).toEqual({ ledger: 1, loot: 0, raids: 0 });
    const lootOnly = pruneAcknowledged(exported, ack, new Set(["loot-delta"]));
    expect(lootOnly.omitted).toEqual({ ledger: 0, loot: 1, raids: 0 });
    expect(pruneAcknowledged(exported, ack, new Set()).omitted).toEqual({ ledger: 0, loot: 0, raids: 0 });
  });
});

describe("GuildedData, the companion's own addon folder", () => {
  it("writes a TOC that matches Guilded's interface and loads after it", async () => {
    const game = gameFolder();
    const path = await writeDataAddon(game.standings, "GuildedStandings = { updatedAt = \"2026-10-15T00:00:00.000Z\", players = {} }", "2026-10-15T00:00:00.000Z");
    expect(path).toBe(join(game.data, "Standings.lua"));
    const toc = readFileSync(join(game.data, "GuildedData.toc"), "utf8");
    expect(toc).toContain("## Interface: 16001, 20506");
    expect(toc).toContain("## Dependencies: Guilded");
    expect(toc).toContain("Standings.lua");
  });

  it("is not written without Guilded's TOC", async () => {
    const game = gameFolder(false);
    expect(await writeDataAddon(game.standings, "x", "2026")).toBeNull();
    expect(existsSync(game.data)).toBe(false);
  });

  it("does not create recovery data after sync was cancelled", async () => {
    const game = gameFolder();
    const controller = new AbortController(); controller.abort();
    await expect(writeDataAddon(game.standings, "x", "2026", controller.signal)).rejects.toThrow();
    expect(existsSync(game.data)).toBe(false);
  });

  it("keeps the main file's personal data when the shared timestamp ties", () => {
    const s = newLuaSession();
    s.run('GuildedStandings = { updatedAt = "2026-10-15T10:00:00.000Z" }; GuildedLedgerAccepted = { fresh = true }');
    s.run(guardedStandings('GuildedLedgerAccepted = { stale = true }', "2026-10-15T10:00:00.000Z"));
    expect(s.run("return tostring(GuildedLedgerAccepted.fresh)")).toBe("true");
    s.close();
  });

  it("never replaces newer data from Guilded's own Standings.lua", () => {
    const file = (stamp: string, ep: number) => standingsToLua({ updatedAt: stamp, baseGp: 0, standings: [{ character: "Kev", ep, gp: 1, main: true }] });
    const run = (legacy: string, data: string) => {
      const s = newLuaSession();
      s.run(legacy);
      s.run(guardedStandings(data, /updatedAt = "([^"]+)"/.exec(data)![1]));
      const ep = s.run("return tostring(GuildedStandings.players[1].ep)");
      s.close();
      return ep;
    };
    // An addon update emptied Guilded's own file: the data addon fills in.
    expect(run(readFileSync(new URL("../addon/Guilded/Standings.lua", import.meta.url), "utf8"), file("2026-10-15T10:00:00.000Z", 50))).toBe("50");
    // The data addon is older (the browser companion wrote Guilded's file since): Guilded's wins.
    expect(run(file("2026-10-15T12:00:00.000Z", 70), file("2026-10-15T10:00:00.000Z", 50))).toBe("70");
    expect(run(file("2026-10-15T10:00:00.000Z", 50), file("2026-10-15T12:00:00.000Z", 90))).toBe("90");
  });
});

// A bot that knows the newer protocol: ETag, gzip uploads, acknowledgements and long polls.
function newerBot(options: { ledger: string[] }) {
  const calls: { url: string; since: string | null; wait: string | null }[] = [];
  const uploads: unknown[] = [];
  let version = 1;
  const body = () => ({
    protocolVersion: 2, botVersion: "6.2.0", updatedAt: `2026-10-15T10:00:0${version}.000Z`, baseGp: 0,
    features: ["gzip-upload", "ledger-delta", "loot-delta", "etag", "long-poll"],
    acceptedLedgerRefs: options.ledger, acceptedLootRefs: [],
    standings: [{ character: "Kev", ep: 10 * version, gp: 0, main: true }]
  });
  const fetch = vi.fn(async (url: URL | string, init?: { method?: string; body?: Buffer | string; headers?: Record<string, string> }) => {
    const target = new URL(String(url));
    if (target.pathname === "/api/v1/standings") {
      calls.push({ url: target.pathname, since: target.searchParams.get("since"), wait: target.searchParams.get("wait") });
      const etag = `"v${version}"`;
      if (target.searchParams.get("since") === etag) return { ok: false, status: 304, headers: new Headers({ etag }), json: async () => ({}) };
      return { ok: true, status: 200, headers: new Headers({ etag }), json: async () => body() };
    }
    const raw = init?.headers?.["content-encoding"] === "gzip" ? gunzipSync(init.body as Buffer).toString("utf8") : String(init?.body);
    uploads.push({ encoding: init?.headers?.["content-encoding"] ?? null, payload: JSON.parse(raw) });
    return { ok: true, status: 201, headers: new Headers(), json: async () => ({ autoApplied: { epgp: 1, discovered: 0 }, botVersion: "6.2.0" }) };
  });
  return { fetch, calls, uploads, bump: () => { version++; } };
}

const savedFile = `GuildedDB = {
  ["epgp"] = { ["Kev"] = { ["ep"] = 15, ["gp"] = 0, ["ledger"] = {
    { ["id"] = "Kev-1-1", ["epAmount"] = 10, ["gpAmount"] = 0, ["type"] = "EP_AWARD", ["reason"] = "Raid night" },
    { ["id"] = "Kev-1-2", ["epAmount"] = 5, ["gpAmount"] = 0, ["type"] = "EP_AWARD", ["reason"] = "Boss kill" },
  } } },
}`;

describe("companion engine with a newer bot", () => {
  it("does not restart timers when stopped during its initial standings request", async () => {
    const game = gameFolder();
    writeFileSync(game.file, savedFile);
    let requested = false;
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init: { signal: AbortSignal }) => {
      requested = true;
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }));
    const interval = vi.spyOn(globalThis, "setInterval");
    const engine = createEngine({ watchFile: game.file, realm: "R", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "1", companionCredential: "x".repeat(43) });
    try {
      const starting = engine.start();
      await vi.waitFor(() => expect(requested).toBe(true));
      interval.mockClear();
      await engine.stop();
      expect(await starting).toBe(false);
      expect(interval).not.toHaveBeenCalled();
      expect(engine.state()).toMatchObject({ running: false, standingsMode: null });
    } finally { await engine.stop(); interval.mockRestore(); }
  });

  it("compresses uploads, leaves out stored entries and follows changes live", async () => {
    // Keep real filesystem I/O, but drive the poll/upload timers explicitly. A busy
    // Windows worker must not have to finish several real 2-second poll gaps in 6s.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const game = gameFolder();
    writeFileSync(game.file, savedFile);
    const bot = newerBot({ ledger: ["addon:qg:Kev-1-1"] });
    vi.stubGlobal("fetch", bot.fetch);
    const writes = vi.fn();
    const errors: string[] = [];
    const engine = createEngine({ watchFile: game.file, realm: "R", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "1", companionCredential: "x".repeat(43) }, {
      onLog: ({ level, message }: { level: string; message: string }) => {
        if (message.startsWith("Wrote EPGP standings")) writes();
        if (level === "error") errors.push(message);
      }
    });
    try {
      expect(await engine.start()).toBe(true);
      expect(engine.state().standingsMode).toBe("live");
      await vi.waitFor(() => expect(bot.uploads).toHaveLength(1));
      const upload = bot.uploads[0] as { encoding: string; payload: { export: { epgpTransactions: { sourceRef: string }[] } } };
      expect(upload.encoding).toBe("gzip");
      expect(upload.payload.export.epgpTransactions.map((row) => row.sourceRef)).toEqual(["qg:Kev-1-2"]);
      // The data addon is written next to Guilded's own file.
      expect(readFileSync(join(game.data, "Standings.lua"), "utf8")).toContain("ep = 10");
      // Long polls carry the ETag (also as `since`, for the website proxy).
      await vi.waitFor(() => expect(bot.calls.some((call) => call.since === "\"v1\"" && call.wait === "12")).toBe(true));
      // A change on the bot reaches the addon folder without waiting minutes.
      bot.bump();
      // The engine announces a write only after BOTH files and its ETag are ready.
      // Polling the main file used to observe the rename before the refresh finished,
      // then overwrite it while the worker was still writing GuildedData.
      await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(2), { timeout: 6000 });
      expect(readFileSync(game.standings, "utf8")).toContain("ep = 20");
      expect(readFileSync(join(game.data, "Standings.lua"), "utf8")).toContain("ep = 20");
      // An addon update replaced Standings.lua with the empty one it ships: written again.
      const beforeRepair = bot.calls.length;
      writeFileSync(game.standings, "GuildedStandings = { updatedAt = nil, baseGp = 0, players = {} }\n");
      await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(3), { timeout: 6000 });
      expect(readFileSync(game.standings, "utf8")).toContain("ep = 20");
      expect(bot.calls.slice(beforeRepair)).toEqual([
        { url: "/api/v1/standings", since: '"v2"', wait: "12" },
        { url: "/api/v1/standings", since: null, wait: null }
      ]);
      expect(errors).toEqual([]);
    } finally { await engine.stop(); }
  }, 20_000);

  it("keeps the old behaviour with an older bot: plain uploads, everything sent, interval refresh", async () => {
    const game = gameFolder();
    writeFileSync(game.file, savedFile);
    const uploads: { headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL | string, init?: { body?: string; headers?: Record<string, string> }) => String(url).includes("standings")
      ? { ok: true, status: 200, json: async () => ({ protocolVersion: 2, updatedAt: "x", baseGp: 0, acceptedLedgerRefs: ["addon:qg:Kev-1-1"], standings: [] }) }
      : (uploads.push({ headers: init!.headers!, body: init!.body! }), { ok: true, status: 201, json: async () => ({ autoApplied: { epgp: 0, discovered: 0 } }) })));
    const engine = createEngine({ watchFile: game.file, realm: "R", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "1", companionCredential: "x".repeat(43) });
    try {
      await engine.start();
      expect(engine.state().standingsMode).toBe("interval");
      await vi.waitFor(() => expect(uploads).toHaveLength(1));
      const [first] = uploads;
      expect(first?.headers["content-encoding"]).toBeUndefined();
      expect(JSON.parse(first?.body ?? "{}").export.epgpTransactions).toHaveLength(2);
    } finally { await engine.stop(); }
  });
});

describe("old raids in uploads", () => {
  it("stops resending finished raids older than 90 days, in seconds, milliseconds or ISO dates", () => {
    const now = Date.UTC(2026, 9, 16);
    const day = 86_400;
    const raids = [
      { ref: "recent", endedAt: now / 1000 - 10 * day },
      { ref: "old-seconds", endedAt: now / 1000 - 91 * day },
      { ref: "old-ms", endedAt: now - 120 * day * 1000 },
      { ref: "old-iso", endedAt: new Date(now - 200 * day * 1000).toISOString() },
      { ref: "no-date" }
    ];
    const { exported, omitted } = pruneOldRaids({ raids, epgpTransactions: [] }, now);
    expect(exported.raids.map((raid: { ref: string }) => raid.ref)).toEqual(["recent", "no-date"]);
    expect(omitted).toBe(3);
    expect(pruneAcknowledged({ raids }, null, undefined, now).omitted).toEqual({ ledger: 0, loot: 0, raids: 3 });
  });
});
