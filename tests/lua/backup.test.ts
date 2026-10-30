import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

// String.raw keeps the Lua escapes (\n, \") exactly as written.
function withBackup(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    DB = {
      version = 4, guildKey = "Alpha-Realm",
      settings = { officers = { Kev = true } },
      raids = { r1 = { id = "r1", title = 'Molten "Core"\nnight', startedAt = "2026-09-24T20:00:00Z" } },
      roster = { Bob = { firstSeen = "x" }, Amy = { firstSeen = "y" } },
      epgp = { Bob = { ep = 50.5, gp = 12, ledger = { { epAmount = 10, gpAmount = 0, reason = "Raid, attendance", at = "t" } } } },
      loot = { { player = "Bob", item = "Helm", cost = 30 } },
      diagnostics = { { kind = "X" } }, peerRoster = { Amy = {} }, events = { 1, 2, 3 }
    }
    NS = {
      now = function() return "2026-09-26T12:00:00Z" end, playerName = function() return "Kev" end,
      getDb = function() return DB end,
      ensureDb = function() DB.settings = DB.settings or {}; DB.raids = DB.raids or {} end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Backup.lua");
  return session;
}

describe("Backup.lua", () => {
  it("round-trips awkward values (quotes, newlines, commas, decimals, number keys)", () => {
    const s = withBackup();
    expect(s.run(String.raw`
      local m = NS.backup
      local value = { a = 'he said "hi"\n', [3] = "three", [-1] = false, nested = { { x = 1.25 }, { y = true } }, empty = {} }
      local back = m.decode(m.encode(value))
      return back.a .. "|" .. back[3] .. "|" .. tostring(back[-1]) .. "|" .. back.nested[1].x .. "|" .. tostring(back.nested[2].y) .. "|" .. tostring(next(back.empty))
    `)).toBe('he said "hi"\n|three|false|1.25|true|nil');
  });

  it("builds a code that leaves out scratch data, and restores it exactly", () => {
    const s = withBackup();
    const code = s.run(`return NS.backup.build()`);
    expect(code.startsWith("QGBKP1:")).toBe(true);
    // Wipe the data, then restore from the code.
    s.run(`DB.raids = nil; DB.epgp = nil; DB.roster = nil; DB.loot = nil; DB.settings = nil`);
    s.run(`CODE = ${JSON.stringify(code)}; RESULT = NS.backup.restore(CODE)`);
    expect(s.run(`return RESULT.raids .. "/" .. RESULT.ledger .. "/" .. RESULT.members`)).toBe("1/1/2");
    expect(s.run(`return DB.raids.r1.title`)).toBe('Molten "Core"\nnight');
    expect(s.run(`return DB.epgp.Bob.ep .. "|" .. DB.epgp.Bob.ledger[1].reason`)).toBe("50.5|Raid, attendance");
    expect(s.run(`return DB.settings.officers.Kev and "officer" or "no"`)).toBe("officer");
    // Scratch data is not in a backup, and it is untouched by a restore.
    expect(s.run(`return tostring(DB.diagnostics ~= nil) .. tostring(DB.peerRoster ~= nil)`)).toBe("truetrue");
    // Decoded payload has no scratch fields.
    const payload = s.run(`local body = (${JSON.stringify(code)}):match("^QGBKP1:%x+:(.+)$"); return NS.backup.b64decode(body)`);
    expect(payload).not.toContain("diagnostics");
    expect(payload).not.toContain("peerRoster");
  });

  it("refuses damaged, foreign and other-guild codes without changing anything", () => {
    const s = withBackup();
    const code = s.run(`return NS.backup.build()`);
    const check = (input: string) => s.run(`local info, err = NS.backup.inspect(${JSON.stringify(input)}); return tostring(info) .. "|" .. tostring(err)`);
    expect(check("hello")).toContain("not a Guilded backup code");
    expect(check(code.slice(0, -8) + "AAAAAAAA")).toContain("damaged");
    expect(check(code.replace(/^QGBKP1:[0-9a-f]+:/, "QGBKP1:00000000:"))).toContain("checksum");
    // A backup made in another guild.
    s.run(`DB.guildKey = "Beta-Realm"`);
    expect(check(code)).toContain("from guild Alpha-Realm");
    expect(s.run(`return DB.raids.r1.title`)).toBe('Molten "Core"\nnight');
  });

  it("keeps the receiving PC's own settings and characters on restore, and undo still works", () => {
    const s = withBackup();
    // The officer who makes the backup: sync on, a chat tab, their own window spot and characters.
    s.run(`DB.settings.ledgerSync = true; DB.settings.ledgerSyncSeen = { Naomine = 1 }; DB.settings.chatTab = true
      DB.settings.panelPoint = { "CENTER" }; DB.settings.setupMode = "local"; DB.settings.activeCore = "local:1"
      DB.myCharacters = { Kev = { name = "Kev" } }; DB.verifyCode = "ABCDEFGH"`);
    const code = s.run(`return NS.backup.build()`);
    // The receiving PC.
    s.run(`DB.settings = { officers = {}, ledgerSync = false, chatTab = false, setupMode = "local", panelPoint = { "TOP" } }
      DB.myCharacters = { Naomine = { name = "Naomine" } }; DB.verifyCode = "KLMNPQRS"`);
    s.run(`NS.backup.restore(${JSON.stringify(code)})`);
    // Guild records come from the backup...
    expect(s.run(`return DB.settings.activeCore .. ":" .. tostring(DB.settings.officers.Kev)`)).toBe("local:1:true");
    expect(s.run(`return DB.epgp.Bob.ep`)).toBe("50.5");
    // ...this PC's own settings stay.
    expect(s.run(`return tostring(DB.settings.ledgerSync) .. ":" .. tostring(DB.settings.ledgerSyncSeen) .. ":" .. tostring(DB.settings.chatTab) .. ":" .. DB.settings.panelPoint[1]`)).toBe("false:nil:false:TOP");
    expect(s.run(`return tostring(DB.myCharacters.Naomine ~= nil) .. ":" .. tostring(DB.myCharacters.Kev)`)).toBe("true:nil");
    // The officer's /guilded verify code would hand this player's characters to the officer.
    expect(s.run(`return DB.verifyCode`)).toBe("KLMNPQRS");
    s.run(`NS.backup.undo()`);
    expect(s.run(`return tostring(DB.settings.activeCore) .. ":" .. tostring(DB.settings.chatTab) .. ":" .. DB.settings.panelPoint[1]`)).toBe("nil:false:TOP");
  });

  it("requires an explicit Forever alias for another realm and rejects another edition", () => {
    const s = withBackup();
    const code = s.run(`return NS.backup.build()`);
    const check = (input: string) => s.run(`local info, err = NS.backup.inspect(${JSON.stringify(input)}); return tostring(info ~= nil) .. "|" .. tostring(err)`);
    // 16 October: one PC said "Classic Beta PvP", the other "Classic Beta PvP 2" for one guild.
    s.run(`DB.guildKey = "Alpha-Realm 2"`);
    expect(check(code)).toContain("from guild Alpha-Realm");
    s.run(`DB.settings.guildRealmAliases = { ["Alpha-Realm"] = "Alpha-Realm 2" }`);
    expect(check(code)).toBe("true|nil");
    s.run(`DB.guildKey = "Beta-Realm 2"`);
    expect(check(code)).toContain("from guild Alpha-Realm");
    s.run(`DB.guildKey = "Alpha-Realm"; GetBuildInfo=function() return "12.1.5","12345","date",120105 end`);
    expect(check(code)).toContain("different WoW edition");
  });

  it("keeps what was there so a restore can be undone", () => {
    const s = withBackup();
    const code = s.run(`return NS.backup.build()`);
    s.run(`DB.epgp.Bob.ep = 999`);
    s.run(`NS.backup.restore(${JSON.stringify(code)})`);
    expect(s.run(`return DB.epgp.Bob.ep`)).toBe("50.5");
    s.run(`NS.commandHandlers["restore"]({ "undo" })`);
    expect(s.run(`return DB.epgp.Bob.ep`)).toBe("999");
    expect(s.chat().join("\n")).toContain("Put back what was there");
    s.run(`NS.commandHandlers["restore"]({ "undo" })`);
    expect(s.chat().join("\n")).toContain("nothing to undo");
  });

  it("rejects hostile or malformed data safely", () => {
    const s = withBackup();
    const parses = (payload: string) => s.run(`return tostring((pcall(NS.backup.decode, ${JSON.stringify(payload)})))`);
    expect(parses('{"a":os.execute("x")}')).toBe("false");
    expect(parses("{".repeat(100))).toBe("false");
    expect(parses('{"a":1} trailing')).toBe("false");
    expect(parses('{"a":1}')).toBe("true");
  });

  it("/guilded backup announces the size and keeps the code", () => {
    const s = withBackup();
    s.run(`NS.commandHandlers["backup"]({})`);
    expect(s.chat().join("\n")).toMatch(/Backup code: \d+ characters/);
    expect(s.run(`return NS.lastBackupCode:sub(1, 7)`)).toBe("QGBKP1:");
  });
});
