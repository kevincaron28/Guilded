import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

// Guilded Setup and Repair (8.5, owner batch 3 #3), and the slimmer companion (#4).
const require = createRequire(import.meta.url);
const { runRepair, repairSummary } = require("../companion-app/repair.cjs");
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;
type Result = { id: string; status: string; text: [string, ...unknown[]] };

const account = "D:\\Jeux\\World of Warcraft\\_forever_\\WTF\\Account\\KEV\\SavedVariables\\Guilded.lua";
function deps(overrides: Record<string, unknown> = {}) {
  return {
    wowEnabled: true,
    watchFile: () => account,
    watchedFileExists: async () => true,
    searchWow: () => ({ entries: [], installs: [] }),
    pick: (entries: { path: string }[]) => entries.length === 1 ? entries[0] : null,
    setWatchFile: vi.fn(async () => {}),
    addonDecision: async () => ({ action: "none", reason: "up-to-date" }),
    installAddon: vi.fn(async () => ({ version: "8.5.0", backup: null })),
    signedIn: () => true,
    me: async () => ({ ok: true, personal: false, account: { username: "kev", displayName: "Kev" } }),
    syncConfigured: () => true,
    syncRunning: () => true,
    restartSync: vi.fn(async () => {}),
    ...overrides
  };
}
const byId = (results: Result[]) => Object.fromEntries(results.map((item) => [item.id, item.status]));

describe("Repair", () => {
  it("says everything is fine when it is", async () => {
    const results = await runRepair(deps());
    expect(byId(results)).toEqual({ folder: "ok", addon: "ok", signin: "ok", link: "ok", sync: "ok" });
    expect(repairSummary(results)).toEqual({ fixed: 0, needsYou: 0, failed: 0, ok: 5 });
  });

  it("finds a moved WoW folder again, installs a missing addon and restarts a stopped sync", async () => {
    let running = false;
    const fixes = deps({
      watchedFileExists: async () => false,
      searchWow: () => ({ entries: [{ path: "E:\\Games\\World of Warcraft\\_forever_\\WTF\\Account\\KEV\\SavedVariables\\Guilded.lua", exists: true }], installs: ["E:\\Games\\World of Warcraft"] }),
      addonDecision: async () => ({ action: "install", reason: "missing" }),
      syncRunning: () => running,
      restartSync: vi.fn(async () => { running = true; })
    });
    const results: Result[] = await runRepair(fixes);
    expect(byId(results)).toEqual({ folder: "fixed", addon: "fixed", signin: "ok", link: "ok", sync: "fixed" });
    expect(fixes.setWatchFile).toHaveBeenCalledWith(expect.stringContaining("E:\\Games"));
    expect(results.find((item) => item.id === "folder")!.text).toEqual(["Found your WoW account folder again: {0}", "_forever_ > KEV"]);
    expect(results.find((item) => item.id === "addon")!.text).toEqual(["Installed the Guilded addon {0}.", "8.5.0"]);
  });

  it("says what is left to the member, and never installs while WoW runs", async () => {
    const results: Result[] = await runRepair(deps({
      watchFile: () => null,
      searchWow: () => ({ entries: [], installs: ["D:\\Jeux\\World of Warcraft"] }),
      addonDecision: async () => ({ action: "update", reason: "older", blocked: "wow-running" }),
      signedIn: () => false,
      syncConfigured: () => false
    }));
    expect(byId(results)).toEqual({ folder: "needs-you", addon: "needs-you", signin: "needs-you" });
    expect(results[0]!.text[0]).toMatch(/no account folder yet/);
  });

  it("tells leaderboards-only, an expired sign-in and an outage apart", async () => {
    const personal: Result[] = await runRepair(deps({ me: async () => ({ ok: true, personal: true, account: { username: "kev" }, join: { serverName: "Québec Gold" } }) }));
    expect(personal.find((item) => item.id === "link")).toMatchObject({ status: "needs-you", text: [expect.stringContaining("Join {0}"), "Québec Gold"] });
    expect(byId(await runRepair(deps({ me: async () => ({ ok: false, error: "This companion link is no longer valid." }) }))).signin).toBe("needs-you");
    expect(byId(await runRepair(deps({ me: async () => ({ ok: false, unreachable: true }) }))).signin).toBe("failed");
  });

  it("reports an addon install that failed", async () => {
    const results: Result[] = await runRepair(deps({ addonDecision: async () => ({ action: "update", reason: "older" }), installAddon: async () => { throw new Error("The addon download did not match the release checksum."); } }));
    expect(results.find((item) => item.id === "addon")).toMatchObject({ status: "failed", text: ["The Guilded addon could not be installed: {0}", "The addon download did not match the release checksum."] });
  });

  it("has French for every result", async () => {
    const scenarios = [
      deps(), deps({ wowEnabled: false }), deps({ watchedFileExists: async () => false, searchWow: () => ({ entries: [{ path: "a\\b\\c\\d\\e", exists: true }], installs: [] }) }),
      deps({ watchFile: () => null, searchWow: () => ({ entries: [{ path: "a", exists: false }, { path: "b", exists: false }], installs: [] }), pick: () => null }),
      deps({ watchFile: () => null }), deps({ watchFile: () => account, watchedFileExists: async () => false, searchWow: () => ({ entries: [{ path: account, exists: false }], installs: [] }) }),
      deps({ addonDecision: async () => ({ action: "none", reason: "not-forever" }) }), deps({ addonDecision: async () => ({ action: "update", reason: "older" }) }),
      deps({ addonDecision: async () => ({ action: "update", reason: "older", blocked: "wow-running" }) }), deps({ addonDecision: async () => ({ action: "install", reason: "missing" }), installAddon: async () => { throw new Error("x"); } }),
      deps({ signedIn: () => false }), deps({ me: async () => ({ ok: false, unsupported: true }) }), deps({ me: async () => ({ ok: false }) }), deps({ me: async () => ({ ok: false, unreachable: true }) }),
      deps({ me: async () => ({ ok: true, personal: true, account: { username: "k" } }) }), deps({ me: async () => ({ ok: true, personal: true, account: { username: "k" }, join: { serverName: "Q" } }) }),
      deps({ syncRunning: () => false }), deps({ syncRunning: () => false, restartSync: async () => { throw new Error("no"); } })
    ];
    for (const scenario of scenarios) for (const item of (await runRepair(scenario)) as Result[]) expect(fr[item.text[0]], item.text[0]).toBeTypeOf("string");
  });
});

describe("a slimmer companion", () => {
  const html = readFileSync("companion-app/renderer/index.html", "utf8");
  it("raid planning and leaderboards open the website instead of companion pages", () => {
    for (const page of ["reserves", "leaderboards", "wishlist", "pricing", "cores"]) expect(html, page).not.toContain(`class="nav optional-page" data-page="${page}"`);
    expect(html).not.toContain('<button class="nav" data-page="leaderboards">');
    for (const path of ["/leaderboards/", "/me/raid-plans", "/me/"]) expect(html).toContain(`data-web-path="${path}"`);
    // The pages stay in the file, so nothing the sync or a deep link needs is gone.
    for (const page of ["page-reserves", "page-leaderboards", "page-wishlist", "page-pricing", "page-cores"]) expect(html).toContain(`id="${page}"`);
  });
  it("Repair is on Home, on Problems and in the setup wizard", () => {
    for (const id of ["btnRepair", "btnRepairProblems", "btnWizardRepair", "btnWizardSetup", "repairDialog", "repairResults"]) expect(html).toContain(`id="${id}"`);
    for (const text of ["Repair", "Set up WoW and the addon", "ON THE WEBSITE", "Raids, cores and prices", "Reserves and wishlist"]) expect(fr[text], text).toBeTypeOf("string");
  });
});
