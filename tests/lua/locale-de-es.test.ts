import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { fromCsv, luaDecode, luaEncode, readTable, toCsv, writeBlock } from "../../scripts/addon-locale.mjs";

// German and Spanish (7.4): chosen from the game client or /guilded lang, English for anything
// not translated yet. Translators edit a CSV; scripts/addon-locale.mjs writes the escaped Lua.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function locale(client: string, chosen?: string): LuaSession {
  session = newLuaSession();
  session.run(`
    SETTINGS = { language = ${chosen ? `"${chosen}"` : "nil"} }
    GetLocale = function() return "${client}" end
    MESSAGES = {}
    NS = { getSettings = function() return SETTINGS end, message = function(text) MESSAGES[#MESSAGES + 1] = text end }
  `);
  session.load("Locale.lua");
  return session;
}

describe("German and Spanish in the addon", () => {
  it("follows a German or Spanish game client, with English for untranslated text", () => {
    const de = locale("deDE");
    expect(de.run(`return NS.language()`)).toBe("de");
    expect(de.run(`return NS.L("Standings")`)).toBe("Rangliste");
    expect(de.run(`return NS.L("Close")`)).toBe("Schließen");
    expect(de.run(`return NS.L("Not a translated line")`)).toBe("Not a translated line");
    de.close();
    const es = locale("esMX");
    expect(es.run(`return NS.language()`)).toBe("es");
    expect(es.run(`return NS.L("Overview")`)).toBe("Resumen");
    expect(es.run(`return string.format(NS.L("Page %d / %d"), 2, 3)`)).toBe("Página 2 / 3");
  });

  it("lets /guilded lang pick German or Spanish over the client, and auto go back", () => {
    const s = locale("enUS");
    expect(s.run(`return NS.language()`)).toBe("en");
    s.run(`NS.commandHandlers["lang"]({ "de" })`);
    expect(s.run(`return SETTINGS.language .. "|" .. MESSAGES[#MESSAGES]`)).toBe("de|Sprache: Deutsch. /reload, um das Fenster zu aktualisieren.");
    s.run(`NS.commandHandlers["lang"]({ "es" })`);
    expect(s.run(`return NS.L("Guild")`)).toBe("Hermandad");
    s.run(`NS.commandHandlers["lang"]({ "auto" })`);
    expect(s.run(`return NS.language()`)).toBe("en");
  });
});

describe("translator kit", () => {
  it("round-trips accents through Lua byte escapes and keeps the file ASCII", () => {
    const text = "Schließen \"Ü\" ñ\n%d%%";
    expect(luaEncode(text)).toMatch(/^[\x20-\x7e]*$/);
    expect(luaEncode("ß")).toBe("\\195\\159");
    expect(luaDecode(luaEncode(text))).toBe(text);
  });

  it("writes a language block from CSV rows and reads it back", () => {
    const source = 'local FR = {\n  ["Close"] = "Fermer",\n}\n-- BEGIN DE\nlocal DE = {\n}\n-- END DE\n';
    const rows = fromCsv(toCsv([["english", "de"], ["Close", "Schließen"], ["Skipped", ""]]));
    const written = writeBlock(source, "DE", new Map(rows.slice(1).map(([en, de]) => [en!, de ?? ""])));
    expect(written).toContain('["Close"] = "Schlie\\195\\159en",');
    expect(written).not.toContain("Skipped");
    expect(readTable(written, "DE").get("Close")).toBe("Schließen");
    expect(readTable(written, "FR").get("Close")).toBe("Fermer");
  });
});
