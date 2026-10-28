import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { fromCsv, luaDecode, luaEncode, readTable, toCsv, writeBlock, formatSlots } from "../../scripts/addon-locale.mjs";
import { readFileSync } from "node:fs";

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
  it("covers the full catalogue and preserves formatting, named fields and links", () => {
    const source = readFileSync("addon/Guilded/Locale.lua", "utf8");
    const reference = readTable(source, "FR");
    expect(reference.size).toBeGreaterThanOrEqual(1010);
    const protectedTokens = (text: string) => text.match(/\{(?:guild|name)\}|\|c[\da-fA-F]{8}|\|r|https?:\/\/[^\s]+/g) ?? [];
    for (const lang of ["FR", "DE", "ES"]) {
      const entries = readTable(source, lang);
      for (const key of reference.keys()) expect(entries.get(key)?.trim(), `${lang}: ${key}`).toBeTruthy();
      for (const [key, value] of entries) {
        expect(formatSlots(value), `${lang}: ${key}`).toEqual(formatSlots(key));
        expect(protectedTokens(value).sort(), `${lang}: ${key}`).toEqual(protectedTokens(key).sort());
      }
    }
    expect(formatSlots("%d:%02d / %.2f / %d%% / %-12s")).toEqual(["%d", "%02d", "%.2f", "%d", "%%", "%-12s"]);
    expect(formatSlots("80% de presencia")).toEqual([]);
  });

  it.each(["deDE", "esES", "esMX"])("formats timer, ledger and roster messages on %s", client => {
    const s = locale(client);
    expect(s.run(`return string.format(NS.L("Trade: %s -> %s: %s (%d:%02d left)"), "Ann", "Bob", "Sword", 1, 5)`)).toContain("1:05");
    expect(s.run(`return NS.L("Roster changed; recovery would overwrite newer data.")`)).not.toBe("Roster changed; recovery would overwrite newer data.");
    expect(s.run(`return NS.L("GRM confirmation: IMPORT. Recovery: UNDO IMPORT. Archives stay on this character; no guild notes are changed.")`)).toContain("UNDO IMPORT");
  });
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
