import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Companion redesign PR 2 (docs/plans/COMPANION_REDESIGN.md, owner's answers of 7 November):
// Sync, Guild, Server (officers only), Tools (PoE2 under it), Settings; then the website; then
// Help and Activity. Link everything opens by itself on every start until setup is done.
const require = createRequire(import.meta.url);
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;
const html = readFileSync("companion-app/renderer/index.html", "utf8");
const app = readFileSync("companion-app/renderer/app.js", "utf8");
const nav = html.slice(html.indexOf('<nav id="companion-navigation"'), html.indexOf("</nav>"));

describe("the menu", () => {
  it("lists the entries in order, with Server for officers only and no PoE2 screen", () => {
    const pages = [...nav.matchAll(/<button class="nav[^"]*"[^>]*data-page="([a-z]+)"/g)].map((match) => match[1]);
    expect(pages).toEqual(["status", "characters", "server", "wow", "settings", "help", "activity"]);
    expect(nav).toMatch(/data-page="server" id="serverNav" hidden/);
    expect(nav).not.toContain('data-page="poe"');
    expect(html).not.toContain("Path of Exile");
    expect(html).not.toContain("Diablo");
    for (const label of [">Sync</button>", ">Guild</button>", ">Server</button>", ">Tools</button>"]) expect(nav, label).toContain(label);
    expect(nav).toMatch(/>Settings <span id="setupBadge"/);
  });

  it("no longer shows Link everything or More tools; Settings can run setup again", () => {
    expect(nav).not.toContain('data-page="link"');
    expect(nav).not.toContain("More tools");
    expect(html).not.toContain('id="navExtras"');
    expect(app).not.toContain("navExtras");
    expect(html).toContain('<button id="btnRunSetup" type="button" data-go="link">Run setup again</button>');
  });

  it("names each page the same way in the breadcrumb, in English and French", () => {
    expect(app).toMatch(/const names = \{status:'Sync',link:'Link everything',characters:'Guild',/);
    expect(app).toMatch(/wow:'Tools',poe:'PoE2 mapping',settings:'Settings',/);
    for (const key of ["Sync", "Guild", "Server", "Tools", "Settings", "Run setup again", "Help & privacy", "Activity", "PoE2 mapping", "Link everything"]) expect(fr[key], key).toBeTruthy();
  });
});

describe("Link everything at start", () => {
  it("opens on every start until setup is done; Skip lasts this run only", () => {
    expect(app).toMatch(/showPage\(new URLSearchParams\(location\.search\)\.get\('tab'\) \|\| \(!setupDone\(all\.config\) && !linkSkipped\(\) \? 'link' : 'status'\)\);/);
    expect(app).toContain("sessionStorage.getItem('guilded.companion.linkSkipped')");
    expect(readFileSync("companion-app/renderer/link-everything.js", "utf8")).toContain("sessionStorage.setItem('guilded.companion.linkSkipped', '1')");
  });

  it("counts setup as done when signed in and syncing has what it needs", () => {
    const body = /function setupDone\(config\) \{([\s\S]*?)\r?\n\}/.exec(app)?.[1];
    expect(body).toBeTruthy();
    const setupDone = new Function("config", body as string) as (config: Record<string, unknown>) => boolean;
    expect(setupDone({})).toBe(false);
    expect(setupDone({ companionCredential: "c" })).toBe(false);
    expect(setupDone({ companionCredential: "c", watchFile: "D:\\WoW\\Guilded.lua" })).toBe(true);
    expect(setupDone({ companionCredential: "c", personal: true })).toBe(true);
    expect(setupDone({ companionCredential: "c", wowEnabled: false })).toBe(true);
    expect(setupDone({ watchFile: "D:\\WoW\\Guilded.lua" })).toBe(false);
    // (9.1.3) Zero-setup: the device key syncs without any sign-in.
    expect(setupDone({ device: true, deviceSecret: "set", watchFile: "D:\\WoW\\Guilded.lua" })).toBe(true);
    expect(setupDone({ device: true, deviceSecret: "set" })).toBe(false);
  });
});
