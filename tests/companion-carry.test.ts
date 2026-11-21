import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { carryReceiptsToLua, carryReport, exportCarriedRecords, parseCarryReceipts, readCarryReceipts, receiptIdsOf, writeCarryReceipts } from "../companion/carry.mjs";
import { pruneAcknowledged } from "../companion/delta.mjs";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { featuresLua } from "../companion/group-relay.mjs";

// 9.3.2: the companion sends the records an addon carried for nearby players, and writes the bot's receipts where the addon reads them.

const duel = { winner: "Aldric Stone", loser: "Brenna Vale", at: 1_800_000_000, reason: "knockout", side: "winner" };
const database = { carry: { records: {
  "externalDuel:x1-aaaa": { kind: "externalDuel", key: "x1-aaaa", author: "Aldric Stone", data: duel, at: 10 },
  "externalDuel:x2-aaaa": { kind: "externalDuel", key: "x2-aaaa", author: "Aldric Stone", data: duel, at: 20 },
  broken: { kind: "externalDuel", key: "x", author: "", data: duel },
  huge: { kind: "externalDuel", key: "x3-aaaa", author: "Aldric Stone", data: { text: "y".repeat(3000) }, at: 30 }
} } };

const body = (full: unknown, options: Record<string, unknown>) => deviceUploadBody(full, options) as { carriedRecords?: unknown[] };

describe("carried records in the saved file", () => {
  it("exports valid records newest first and leaves out malformed or oversized ones", () => {
    const rows = exportCarriedRecords(database);
    expect(rows.map((row: { key: string }) => row.key)).toEqual(["x2-aaaa", "x1-aaaa"]);
    expect(exportCarriedRecords({})).toEqual([]);
    expect(exportCarriedRecords(database, { acknowledged: new Set(["externalDuel:x2-aaaa"]) }).map((row: { key: string }) => row.key)).toEqual(["x1-aaaa"]);
  });

  it("goes to a bot that announced the feature only, and not again once acknowledged", () => {
    const full = { carriedRecords: exportCarriedRecords(database), dungeonRuns: [] };
    expect(pruneAcknowledged(full, null, new Set(["ledger-delta"])).exported.carriedRecords).toBeUndefined();
    expect(pruneAcknowledged(full, null, new Set(["carry-records"])).exported.carriedRecords).toHaveLength(2);
    const after = pruneAcknowledged(full, { carry: new Set(["externalDuel:x1-aaaa", "externalDuel:x2-aaaa"]) }, new Set(["carry-records"]));
    expect(after.exported.carriedRecords).toBeUndefined();
  });

  it("is part of an unsigned upload only when the bot handles it", () => {
    const full = { wowGuild: "Quebec Gold|Forever", character: { name: "Kev", realm: "Forever" }, carriedRecords: exportCarriedRecords(database) };
    expect(body(full, {}).carriedRecords).toBeUndefined();
    expect(body(full, { carry: true }).carriedRecords).toHaveLength(2);
    expect(body(full, { carry: true, carryAcknowledged: new Set(["externalDuel:x1-aaaa"]) }).carriedRecords).toHaveLength(1);
    expect(body(full, { carry: true, runsOnly: true }).carriedRecords).toBeUndefined();
  });

  it("tells the addon this companion carries records", () => {
    expect(featuresLua("2026-11-14T10:00:00Z")).toContain("carry-records");
  });
});

describe("receipts for the addon", () => {
  const dirs: string[] = [];
  afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

  it("round-trips ids through Carry.lua", () => {
    const text = carryReceiptsToLua(["externalDuel:x1-aaaa", 'odd"id\\'], "now");
    expect(parseCarryReceipts(text)).toEqual(["externalDuel:x1-aaaa", 'odd"id\\']);
  });

  it("takes only prefixed receipts of the answer", () => {
    expect(receiptIdsOf({ carriedReceipts: ["carry:externalDuel:x1-aaaa", "group:abc", 5] })).toEqual(["externalDuel:x1-aaaa"]);
    expect(receiptIdsOf({})).toEqual([]);
  });

  it("writes beside both addons that are installed and keeps earlier receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "carry-"));
    dirs.push(root);
    const addons = join(root, "Interface", "AddOns");
    await mkdir(join(addons, "Guilded"), { recursive: true });
    await mkdir(join(addons, "GuildedDungeons"), { recursive: true });
    await writeFile(join(addons, "Guilded", "Standings.lua"), "", "utf8");
    const config = { watchFile: join(root, "WTF", "Account", "A", "SavedVariables", "Guilded.lua") };
    const first = await writeCarryReceipts(config, { carriedReceipts: ["carry:externalDuel:x1-aaaa"] });
    expect(first).toHaveLength(2);
    await writeCarryReceipts(config, { carriedReceipts: ["carry:externalDuel:x2-bbbb"] });
    expect([...await readCarryReceipts(config)].sort()).toEqual(["externalDuel:x1-aaaa", "externalDuel:x2-bbbb"]);
    expect(await readFile(join(addons, "GuildedDungeons", "Carry.lua"), "utf8")).toContain("GuildedCarryReceipts");
    expect(await writeCarryReceipts(config, { carriedReceipts: ["carry:externalDuel:x2-bbbb"] })).toEqual([]);
  });
});

describe("the activity line for carried records", () => {
  const sentRows = [{ kind: "externalDuel", key: "1794678973-a67318" }, { kind: "externalDuel", key: "1794679100-b11c02" }];

  it("says how many went and how many the bot accepted, from the receipts of the answer", () => {
    expect(carryReport(sentRows, { carriedReceipts: ["carry:externalDuel:1794678973-a67318", "carry:externalDuel:1794679100-b11c02"] })).toEqual({ level: "ok", message: "Carried records: 2 sent, 2 accepted." });
    expect(carryReport(sentRows, { carriedReceipts: ["carry:externalDuel:1794678973-a67318"] })).toEqual({ level: "info", message: "Carried records: 2 sent, 1 accepted, 1 not answered yet." });
    expect(carryReport(sentRows, {})?.message).toBe("Carried records: 2 sent, 0 accepted, 2 not answered yet.");
  });

  it("says nothing when no record was sent, and names the bot's answer when the upload was refused", () => {
    expect(carryReport([], { carriedReceipts: ["carry:externalDuel:x"] })).toBeNull();
    expect(carryReport(undefined, {})).toBeNull();
    expect(carryReport(sentRows, {}, { ok: false, error: "Too many requests: wait a minute." })).toEqual({ level: "warn", message: "Carried records: 2 sent, not accepted (Too many requests: wait a minute.)." });
  });

  it("is translated for the French window", async () => {
    const { createRequire } = await import("node:module");
    const i18n = createRequire(import.meta.url)("../companion-app/i18n.cjs") as { message: (language: string, text: string) => string };
    expect(i18n.message("fr", "Carried records: 2 sent, 2 accepted.")).toBe("Données relayées : 2 envoyée(s), 2 acceptée(s).");
    expect(i18n.message("fr", "Carried records: 2 sent, 1 accepted, 1 not answered yet.")).toContain("1 sans réponse");
    expect(i18n.message("fr", "Carried records: 2 sent, not accepted (Too many requests).")).toContain("non acceptée(s) (Too many requests)");
  });

  it("writes the receipt of a real-shaped record where the addon reads it, from a device config without a standings file", async () => {
    const root = await mkdtemp(join(tmpdir(), "carry-real-"));
    try {
    const addons = join(root, "Interface", "AddOns");
    await mkdir(join(addons, "Guilded"), { recursive: true });
    const config = { watchFile: join(root, "WTF", "Account", "ACC", "SavedVariables", "Guilded.lua") };
    const written = await writeCarryReceipts(config, { carriedReceipts: ["carry:externalDuel:1794678973-a67318"] });
    expect(written).toEqual([join(addons, "Guilded", "Carry.lua")]);
    const text = await readFile(join(addons, "Guilded", "Carry.lua"), "utf8");
    expect(parseCarryReceipts(text)).toEqual(["externalDuel:1794678973-a67318"]);
    expect(text).toContain("GuildedCarryReceipts = {");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
