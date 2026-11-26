import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";


describe("guide language switch", () => {
  it("updates the URL when the French guide anchor is selected", () => {
    const listeners = {};
    const window = {
      location: { href: "https://guilded.test/docs/QUICK_START.html?lang=en", hash: "" },
      localStorage: { getItem: () => null, setItem: () => {} },
      history: { state: null, replaceState: (_state, _title, url) => { window.location.href = String(url); window.location.hash = url.hash; } },
      addEventListener: (name, callback) => { listeners[name] = callback; },
      dispatchEvent: () => {}, CustomEvent: class {}
    };
    const document = { dispatchEvent() {}, documentElement: {}, querySelectorAll: selector => selector === "[data-set-language]" ? [{ dataset: { setLanguage: "en" }, setAttribute() {}, addEventListener() {} }] : [], querySelector: () => null };
    const code = readFileSync("site/language.js", "utf8").replace(/^import .*\r?\n/m, "");
    runInNewContext(code, { window, document, URL, URLSearchParams, localizedHref: href => href });
    window.location.href += "#fr"; window.location.hash = "#fr"; listeners.hashchange();
    expect(window.location.href).toBe("https://guilded.test/docs/QUICK_START.html?lang=fr#fr");
    expect(document.documentElement.lang).toBe("fr");
  });
  // A page load with the given address and remembered choice; returns the page language and what was written back.
  const load = (href, remembered = null) => {
    const writes = [], clicks = {};
    const url = new URL(href);
    const window = {
      location: { href, hash: url.hash, search: url.search, pathname: url.pathname },
      localStorage: { getItem: () => remembered, setItem: (_key, value) => writes.push(value) },
      history: { state: null, replaceState: () => {} }, addEventListener: () => {}, dispatchEvent: () => {}, CustomEvent: class {}
    };
    const buttons = ["en", "fr"].map(language => ({ dataset: { setLanguage: language }, setAttribute() {}, addEventListener: (_name, callback) => { clicks[language] = callback; } }));
    const document = { dispatchEvent() {}, documentElement: {}, querySelectorAll: selector => selector === "[data-set-language]" ? buttons : [], querySelector: () => null };
    runInNewContext(readFileSync("site/language.js", "utf8").replace(/^import .*\r?\n/m, ""), { window, document, URL, URLSearchParams, localizedHref: value => value });
    return { language: () => document.documentElement.lang, writes, click: language => clicks[language]() };
  };
  it("keeps a /fr/ address in French and stores nothing the visitor did not choose", () => {
    for (const remembered of [null, "en"]) {
      const page = load("https://guildedwow.com/fr/guide/start/", remembered);
      expect(page.language()).toBe("fr");
      expect(page.writes).toEqual([]);
    }
    expect(load("https://guildedwow.com/fr").language()).toBe("fr");
    expect(load("https://guildedwow.com/friends/").language()).toBe("en");
    const english = load("https://guildedwow.com/guide/start/");
    expect(english.language()).toBe("en");
    expect(english.writes).toEqual([]);
    const remembered = load("https://guildedwow.com/download/", "fr");
    expect(remembered.language()).toBe("fr");
    expect(remembered.writes).toEqual([]);
  });
  it("remembers the language the visitor chooses", () => {
    const page = load("https://guildedwow.com/fr/guide/start/");
    page.click("en");
    expect(page.language()).toBe("en");
    expect(page.writes).toEqual(["en"]);
    const asked = load("https://guildedwow.com/fr/download/?lang=en", "fr");
    expect(asked.language()).toBe("en");
    expect(asked.writes).toEqual(["en"]);
  });
  it("points French readers to the French automation section", () => {
    expect(readFileSync("docs/QUICK_START.md", "utf8")).toContain("AUTOMATION_QUICK_START.html?lang=fr#fr");
    expect(readFileSync("dist/site/docs/AUTOMATION_QUICK_START.html", "utf8")).toContain('<h2 id="fr">Français</h2>');
  });
});
