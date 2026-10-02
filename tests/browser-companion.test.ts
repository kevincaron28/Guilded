import { File } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readBrowserAddon, readBrowserPoe } from "../companion/browser-files.mjs";
import { parsePoeLogLine, consumePoeEvent } from "../companion/poe-log.mjs";

const profile = { character: "Mapper", league: "Pilot", mode: "STANDARD" };
const line = '2026/01/01 12:00:00 123 abc [DEBUG Client 42] Generating level 80 area "MapSteppe" with seed 77';
const exit = '2026/01/01 12:05:00 456 def [DEBUG Client 42] Generating level 1 area "Hideout" with seed 88';
const now = new Date(2026, 0, 1, 14).getTime();

describe("browser companion local file processing", () => {
  it("agrees with the shared parser on the synthetic localized lifecycle and CRLF", async () => {
    const fixture = readFileSync(new URL('./fixtures/poe2/lifecycle.txt', import.meta.url), 'utf8');
    const journal = { active: null, pending: [] };
    for (const entry of fixture.split(/\r?\n/)) consumePoeEvent(journal, parsePoeLogLine(entry), profile);
    const result = await readBrowserPoe(new File([fixture.replace(/\r?\n/g, '\r\n')], 'Client.txt'), profile, new Date(2026, 8, 30, 13).getTime());
    expect(result.visits).toEqual(journal.pending); expect(result.visits).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/private fixture chat|slain|Vous/);
  });
  it("rejects UTF-16 and waits for a complete final transition", async () => {
    await expect(readBrowserPoe(new File([Buffer.from('\ufeff' + line, 'utf16le')], 'Client.txt'), profile, now)).rejects.toThrow('UTF-16');
    expect((await readBrowserPoe(new File([`${line}\n${exit}`], 'Client.txt'), profile, now)).visits).toEqual([]);
    expect((await readBrowserPoe(new File([`${line}\n${exit}\r\n`], 'Client.txt'), profile, now)).visits).toHaveLength(1);
  });
  it("uses the real addon parser without executing Lua", async () => {
    const file = new File(['GuildedDB = { addonVersion = "5.0.0", character = { name = "Ann", class = "Mage", level = 70 }, epgp = {} }'], "Guilded.lua");
    expect(await readBrowserAddon(file, "R")).toMatchObject({ addonVersion: "5.0.0", character: { name: "Ann", realm: "R", class: "Mage" }, epgpTransactions: [] });
    await expect(readBrowserAddon(new File(['GuildedDB = os.execute("malicious")'], "Guilded.lua"), "R")).rejects.toThrow(/Unsupported Lua/);
  });
  it("rejects wrong file types and large addon files", async () => {
    await expect(readBrowserAddon({ size: 16_000_001 } as never, "R")).rejects.toThrow(/16 MB/);
    await expect(readBrowserAddon(new File([""], "config.json"), "R")).rejects.toThrow(/Guilded.lua/);
  });
  it("produces the same PoE2 reference and visit as the installed watcher", async () => {
    const desktop = { active: null, pending: [] };
    consumePoeEvent(desktop, parsePoeLogLine(line), profile); consumePoeEvent(desktop, parsePoeLogLine(exit), profile);
    const result = await readBrowserPoe(new File([`${line}\n${exit}\n`], "Client.txt"), profile, now);
    expect(result.visits).toEqual(desktop.pending);
    const hash = createHash("sha256").update(line).digest("hex");
    expect(result.visits[0]?.runRef).toBe(createHash("sha256").update(JSON.stringify([profile.character, profile.league, profile.mode, hash])).digest("hex"));
    expect(JSON.stringify(result.visits)).not.toMatch(/fingerprint|seed|pid/);
  });
  it("ignores chat, old history, repeated engine lines and unfinished visits", async () => {
    const chat = '2026/01/01 12:03:00 222 abc [INFO Client 42] @Private: Secret chat';
    const result = await readBrowserPoe(new File([`${line}\n${line}\n${chat}\n${exit}\n`], "Client.txt"), profile, now);
    expect(result.visits).toHaveLength(1); expect(JSON.stringify(result)).not.toContain("Private");
    expect((await readBrowserPoe(new File([`${line}\n`], "Client.txt"), profile, now)).visits).toEqual([]);
    expect((await readBrowserPoe(new File([`${line}\n${exit}\n`], "Client.txt"), profile, now + 86_400_000)).visits).toEqual([]);
  });
  it("requires declared labels and mode before importing history", async () => {
    const file = new File([line], "Client.txt");
    await expect(readBrowserPoe(file, { ...profile, character: "" }, now)).rejects.toThrow(/character and league/);
    await expect(readBrowserPoe(file, { ...profile, mode: "WRONG" }, now)).rejects.toThrow(/mode/);
  });
});
