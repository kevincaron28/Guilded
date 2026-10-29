import { afterEach, describe, expect, it } from "vitest";
import { createLootHistoryArchive } from "../companion/loot-history-import.mjs";
import { newLuaSession, type LuaSession } from "./lua/harness.js";
const options = { source: "rclootcouncil", guild: "Guild", realm: "Realm", edition: "classic-era", characterMap: { "Amy-Realm": "Amy-Realm" } };
const award = { player: "Amy-Realm", date: "2026/10/29", time: "20:10:12", id: "award-1", itemID: 19364, response: "Main Spec", boss: "Nefarian" };
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });
const literal = (v: string) => `[==[${v}]==]`;
function archive(rows: unknown[] = [award], opts = options, allow = false) { return createLootHistoryArchive(JSON.stringify(rows), opts, allow).code; }
function setup() {
  const s = newLuaSession(); sessions.push(s);
  s.run(`OFFICER=true; GUILD='Guild'; REALM='Realm'; EDITION='classic-era'; DB={loot={{item='Existing'}},epgp={Amy={ep=100,gp=50}}};
    NS={commandHandlers={},commandHelp={},isOfficer=function() return OFFICER end, getDb=function() return DB end,
      playerName=function() return 'Officer' end, now=function() return '2026-10-29T20:00:00Z' end,
      message=function(t) MESSAGE=t end, showCopyText=function(t) COPY=t end,
      showPasteBox=function(title,help,handler) TITLE=title; PASTE=handler end};
    function GetGuildInfo() return GUILD end; function GetRealmName() return REALM end`);
  s.load("Util.lua"); s.run("NS.util.gameEdition=function() return EDITION end");
  for (const file of ["Backup", "RosterTools", "LootImports", "LootHistoryImport"]) s.load(`Modules/${file}.lua`);
  return s;
}
const preview = (s: LuaSession, code = archive()) => s.run(`local r,e=NS.lootHistoryImport.preview(${literal(code)}); return r and 'ok' or e`);
const confirm = (s: LuaSession) => s.run("local ok,e=NS.lootHistoryImport.confirm('IMPORT'); return tostring(ok)..':'..tostring(e)");
describe("in-game loot-history import", () => {
  it("previews real converter output, requires confirmation, persists history and never changes points/awards", () => {
    const s = setup(); expect(preview(s)).toBe("ok");
    expect(s.run("return NS.lootHistoryImport.summary()")).toContain("Amy-Realm -> Amy-Realm");
    expect(s.run("return tostring(NS.rosterTools.store().lootHistory)")).toBe("nil");
    expect(s.run("return tostring((NS.lootHistoryImport.confirm('import')))")).toBe("false");
    expect(confirm(s)).toContain("true:Stored 1");
    expect(s.run("local row=NS.rosterTools.store().lootHistory.rows[1]; return row.source..':'..row.sourceId..':'..row.sourceRow..':'..row.importedBy")).toBe("rclootcouncil:award-1:1:Officer");
    expect(s.run("return #DB.loot..':'..DB.epgp.Amy.ep..':'..DB.epgp.Amy.gp")).toBe("1:100:50");
    s.run("GuildedRosterToolsDB=NS.backup.decode(NS.backup.encode(GuildedRosterToolsDB))");
    s.load("Modules/LootHistoryImport.lua");
    expect(s.run("return NS.lootHistoryImport.history('Amy-Realm')")).toContain("item 19364");
    expect(preview(s)).toBe("ok"); expect(confirm(s)).toContain("already stored");
    expect(s.run("return #NS.rosterTools.store().lootHistory.rows")).toBe("1");
  });
  it("wires the actual slash-command paste/preview/typed-confirm flow", () => {
    const s = setup(); s.run("NS.commandHandlers.import({'history'})");
    expect(s.run("return TITLE")).toBe("Preview loot history");
    expect(s.run(`return tostring((PASTE(${literal(archive())})))`)).toBe("true");
    expect(s.run("return COPY")).toContain("New: 1");
    s.run("NS.commandHandlers.import({'history','confirm'})");
    expect(s.run("return tostring((PASTE('IMPORT')))")).toBe("true");
    s.run("NS.commandHandlers.import({'history','show','Amy-Realm'})");
    expect(s.run("return COPY")).toContain("rclootcouncil");
  });
  it.each(["OFFICER=false", "GUILD='Other'", "REALM='Other'", "EDITION='retail'"])("rechecks permissions and scope at commit: %s", change => {
    const s = setup(); expect(preview(s)).toBe("ok"); s.run(change);
    expect(confirm(s)).toContain("false:");
    s.run("OFFICER=true; GUILD='Guild'; REALM='Realm'; EDITION='classic-era'");
    expect(s.run("return tostring(NS.rosterTools.store().lootHistory)")).toBe("nil");
  });
  it.each(["forever", "classic-era", "classic-tbc", "classic-mists", "retail"])("accepts matching edition %s and isolates other scopes", edition => {
    const s = setup(); s.run(`EDITION='${edition}'`);
    expect(preview(s, archive([award], { ...options, edition }))).toBe("ok"); expect(confirm(s)).toContain("true:");
    s.run("GUILD='Other'"); expect(s.run("return NS.lootHistoryImport.history('')")).toContain("No imported");
  });
  it("deduplicates overlaps across files, refuses conflicts atomically, and undoes only the last batch", () => {
    const s = setup(); preview(s); confirm(s);
    const next = { ...award, id: "award-2", itemID: 17063 };
    expect(preview(s, archive([award, next]))).toBe("ok"); expect(confirm(s)).toContain("Stored 1");
    expect(preview(s, archive([{ ...next, id: "award-3" }, { ...award, itemID: 5 }]))).toContain("conflicts");
    expect(s.run("return #NS.rosterTools.store().lootHistory.rows")).toBe("2");
    expect(s.run("return tostring((NS.lootHistoryImport.undo('UNDO')))")).toBe("false");
    expect(s.run("return tostring((NS.lootHistoryImport.undo('UNDO IMPORT')))")).toBe("true");
    expect(s.run("return #NS.rosterTools.store().lootHistory.rows..':'..NS.rosterTools.store().lootHistory.rows[1].itemId")).toBe("1:19364");
    expect(s.run("return tostring((NS.lootHistoryImport.undo('UNDO IMPORT')))")).toBe("false");
    expect(preview(s, archive([next]))).toBe("ok"); expect(confirm(s)).toContain("Stored 1");
  });
  it("cancels and invalidates a preview when history changes", () => {
    const s = setup(); preview(s); s.run("NS.lootHistoryImport.cancel()"); expect(confirm(s)).toContain("false:");
    preview(s); confirm(s); preview(s, archive([{ ...award, id: "next" }]));
    s.run("NS.rosterTools.store().lootHistory.revision=99"); expect(confirm(s)).toContain("History changed");
  });
  it("requires no-ID acknowledgement and retains legitimate copies but deduplicates the identical file", () => {
    const rows = [{ ...award, id: "" }, { ...award, id: "" }];
    expect(() => archive(rows)).toThrow("acknowledge");
    const s = setup(), code = archive(rows, options, true); expect(preview(s, code)).toBe("ok");
    expect(s.run("return NS.lootHistoryImport.summary()")).toContain("without stable IDs: 2");
    expect(confirm(s)).toContain("Stored 2"); preview(s, code); expect(confirm(s)).toContain("already stored");
  });
  it("imports Gargul JSON dates and preserves plain text instead of executing markup", () => {
    const s = setup();
    const code = archive([{ awardedTo: "Amy-Realm", timestamp: 1793219652, itemID: 19364, checksum: "g-1", OS: true }], { ...options, source: "gargul" });
    expect(preview(s, code)).toBe("ok"); expect(confirm(s)).toContain("true:");
    expect(s.run("return NS.lootHistoryImport.history('19364')")).toContain("UTC");
    preview(s, archive([{ ...award, response: "|Hbad:1|hclick|h", id: "other" }])); confirm(s);
    expect(s.run("return NS.lootHistoryImport.history('click')")).toContain("||Hbad");
  });
  it("rejects corrupt and oversized archives and clears the previous preview", () => {
    const s = setup(); preview(s);
    for (const code of ["GLH1:000000:AAAA", "os.execute('bad')", "x".repeat(400001)]) {
      expect(preview(s, code)).not.toBe("ok"); expect(confirm(s)).toContain("false:");
    }
  });
  it("rejects malformed archives even with a matching transport checksum", () => {
    const rewrite = (change: (text: string) => string) => {
      const bytes = Buffer.from(change(Buffer.from(archive().split(":")[2]!, "base64").toString("utf8")));
      let sum = 0; for (const byte of bytes) sum = (sum * 31 + byte) % 16777213;
      return `GLH1:${sum.toString(16).padStart(6, "0")}:${bytes.toString("base64")}`;
    };
    const s = setup();
    for (const change of [(v: string) => v.replace('"itemId":19364', '"itemId":-1'),
      (v: string) => v.replace('"at":"2026-10-29T20:10:12"', '"at":"2026-02-30T20:10:12"'),
      (v: string) => v.replace('"row":1', '"row":0'),
      (v: string) => v.replace('"boss":"Nefarian"', '"boss":"Nefarian","gp":100'),
      (v: string) => v.replace('"entries":{#1:', '"entries":{#2:')]) {
      expect(preview(s, rewrite(change))).toContain("Unsupported");
      expect(confirm(s)).toContain("false:");
    }
  });
  it("fails atomically at capacity and preserves prior undo state", () => {
    const s = setup(); preview(s); confirm(s);
    s.run("local h=NS.rosterTools.store().lootHistory; for i=2,10000 do h.rows[i]=h.rows[1] end");
    expect(preview(s, archive([{ ...award, id: "next" }]))).toContain("History is full");
    expect(s.run("return #NS.rosterTools.store().lootHistory.rows..':'..tostring(NS.rosterTools.store().lootHistory.undoKeys~=nil)")).toBe("10000:true");
  });
});
