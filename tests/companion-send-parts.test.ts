import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../companion/engine.mjs";

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function saved(runCount: number) {
  const root = mkdtempSync(join(tmpdir(), "qg-parts-")); dirs.push(root);
  const folder = join(root, "WTF", "Account", "ACC", "SavedVariables");
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(root, "Interface", "AddOns", "Guilded"), { recursive: true });
  const file = join(folder, "Guilded.lua");
  const runs = Array.from({ length: runCount }, (_, i) => `["r${i}"] = { id = "r${i}", state = "COMPLETED", instanceId = 33, name = "Dungeon", difficultyId = 1, endedAt = ${1_700_000_000 + i} },`).join("\n");
  writeFileSync(file, `GuildedDB = { version = 3, epgp = { Kev = { ledger = { { id = "first", epAmount = 5, gpAmount = 0, type = "EP_AWARD", reason = "Raid", at = "2026-10-28T00:00:00Z", by = "Kev" } } } }, dungeon = { runs = {\n${runs}\n} } }`);
  return file;
}

type Body = { export: { dungeonRuns?: unknown[]; epgpTransactions?: unknown[] } };

async function run(runCount: number, answer: (index: number) => Response) {
  const file = saved(runCount);
  const bodies: Body[] = [];
  const sizes: number[] = [];
  let index = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string, options: { body?: string }) => {
    if (!String(url).includes("addon-imports")) return Response.json({ protocolVersion: 2, updatedAt: "x", baseGp: 0, standings: [] });
    bodies.push(JSON.parse(String(options.body)));
    sizes.push(String(options.body).length);
    return answer(index++);
  }));
  const timers = vi.spyOn(globalThis, "setTimeout");
  const logs: { level: string; message: string }[] = [];
  const engine = createEngine({ watchFile: file, realm: "R", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "1", companionCredential: "x".repeat(43), liveStandings: false }, { onLog: (entry: { level: string; message: string }) => logs.push(entry) });
  await engine.start();
  engine.uploadNow();
  await vi.waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });
  await vi.waitFor(() => expect(engine.state().pendingUpload).toBe(false), { timeout: 5000 });
  const state = engine.state();
  const delays = timers.mock.calls.map((call) => call[1]);
  await engine.stop();
  return { bodies, sizes, logs, state, delays };
}

const ok = () => Response.json({ transactionCount: 1, importId: "first-part", autoApplied: { epgp: 1, discovered: 0 } });

describe("sendParts through the engine", () => {
  it("sends an export within the limits as one request", async () => {
    const { bodies } = await run(20, ok);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.export.dungeonRuns).toHaveLength(20);
  });

  it("sends the roster and ledger first, then runs in parts of at most 400 under 900 KB", async () => {
    const { bodies, sizes } = await run(1000, ok);
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    expect(bodies[0]!.export.epgpTransactions).toHaveLength(1);
    expect(bodies[0]!.export.dungeonRuns).toBeUndefined();
    expect(bodies.flatMap((b) => b.export.dungeonRuns ?? [])).toHaveLength(1000);
    for (const [i, b] of bodies.entries()) { expect((b.export.dungeonRuns ?? []).length).toBeLessThanOrEqual(400); expect(sizes[i]!).toBeLessThan(900_000); }
  });

  it("a 413 on one extra part is logged with its counts and does not stop the others", async () => {
    const { bodies, logs } = await run(1000, (i) => i === 1 ? Response.json({ error: "too large" }, { status: 413 }) : ok());
    expect(bodies).toHaveLength(4);
    expect(logs.some((l) => l.level === "warn" && /\(400 dungeonRuns\) was not accepted \(413\)/.test(l.message))).toBe(true);
  });

  it("a 503 on an extra part schedules a retry", async () => {
    const { delays, bodies } = await run(1000, (i) => i === 2 ? Response.json({ error: "busy" }, { status: 503 }) : ok());
    expect(bodies).toHaveLength(4);
    expect(delays).toContain(60_000);
  });

  it("receipts and state come from the first part only", async () => {
    const { state, logs } = await run(1000, (i) => i === 0 ? ok() : Response.json({ importId: "later", applyError: "later part failed" }, { status: 200 }));
    expect(state.uploads).toBe(1);
    expect(state.lastUpload?.message).toContain("Uploaded and applied automatically");
    expect(state.lastUpload?.message).not.toContain("later part failed");
    expect(logs.some((l) => l.message.includes("later part failed"))).toBe(false);
  });
});
