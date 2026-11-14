import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain JavaScript module without types
import { carryReceiptsToLua, exportCarriedRecords, parseCarryReceipts, readCarryReceipts, receiptIdsOf, writeCarryReceipts } from "../companion/carry.mjs";
// @ts-expect-error -- plain JavaScript module without types
import { pruneAcknowledged } from "../companion/delta.mjs";
// @ts-expect-error -- plain JavaScript module without types
import { deviceUploadBody } from "../companion/device-sync.mjs";
// @ts-expect-error -- plain JavaScript module without types
import { featuresLua } from "../companion/group-relay.mjs";

// 9.3.2: the companion sends the records an addon carried for nearby players, and writes the bot's receipts where the addon reads them.

const duel = { winner: "Aldric Stone", loser: "Brenna Vale", at: 1_800_000_000, reason: "knockout", side: "winner" };
const database = { carry: { records: {
  "externalDuel:x1-aaaa": { kind: "externalDuel", key: "x1-aaaa", author: "Aldric Stone", data: duel, at: 10 },
  "externalDuel:x2-aaaa": { kind: "externalDuel", key: "x2-aaaa", author: "Aldric Stone", data: duel, at: 20 },
  broken: { kind: "externalDuel", key: "x", author: "", data: duel },
  huge: { kind: "externalDuel", key: "x3-aaaa", author: "Aldric Stone", data: { text: "y".repeat(3000) }, at: 30 }
} } };

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
    expect(deviceUploadBody(full, {}).carriedRecords).toBeUndefined();
    expect(deviceUploadBody(full, { carry: true }).carriedRecords).toHaveLength(2);
    expect(deviceUploadBody(full, { carry: true, carryAcknowledged: new Set(["externalDuel:x1-aaaa"]) }).carriedRecords).toHaveLength(1);
    expect(deviceUploadBody(full, { carry: true, runsOnly: true }).carriedRecords).toBeUndefined();
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
    await writeCarryReceipts(config, { carriedReceipts: ["carry:duel:d1-aaaa"] });
    expect([...await readCarryReceipts(config)].sort()).toEqual(["duel:d1-aaaa", "externalDuel:x1-aaaa"]);
    expect(await readFile(join(addons, "GuildedDungeons", "Carry.lua"), "utf8")).toContain("GuildedCarryReceipts");
    expect(await writeCarryReceipts(config, { carriedReceipts: ["carry:duel:d1-aaaa"] })).toEqual([]);
  });
});
