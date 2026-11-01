import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";

beforeAll(() => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" }), 30000);

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
  it("points French readers to the French automation section", () => {
    expect(readFileSync("docs/QUICK_START.md", "utf8")).toContain("AUTOMATION_QUICK_START.html?lang=fr#fr");
    expect(readFileSync("dist/site/docs/AUTOMATION_QUICK_START.html", "utf8")).toContain('<h2 id="fr">Français</h2>');
  });
});
