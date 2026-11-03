import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { linkSteps, linkSummary } from "../companion/link-everything.mjs";

const require = createRequire(import.meta.url);
const fr: Record<string, string> = require("../companion-app/locales/fr.json");
const { validateIpc } = require("../companion-app/ipc-security.cjs");
const read = (file: string) => readFileSync(file, "utf8");
const byId = (view: ReturnType<typeof linkSteps>, id: string) => view.steps.find(step => step.id === id)!;
const hubWith = (link: unknown, characters = 0) => ({ link, characters: Array.from({ length: characters }, () => ({})) });

describe("companion Link everything status", () => {
  it("starts new users on the first step and sends nothing before sign-in", () => {
    const view = linkSteps({}, {}, null);
    expect(view.firstRun).toBe(true);
    expect(view.complete).toBe(false);
    expect(byId(view, "discord").state).toBe("todo");
    expect(byId(view, "battlenet").state).toBe("waiting");
    expect(byId(view, "characters").state).toBe("waiting");
    expect(view.nextStep?.id).toBe("discord");
  });
  it("keeps Battle.net optional so a Forever player can finish without it", () => {
    const config = { companionCredential: "personal", watchFile: "Guilded.lua" };
    const view = linkSteps(config, { lastUpload: { at: "x" } }, hubWith({ battleNet: false, characters: 2 }, 2));
    expect(byId(view, "battlenet").state).toBe("optional");
    expect(byId(view, "battlenet").required).toBe(false);
    expect(byId(view, "characters").state).toBe("done");
    expect(view.complete).toBe(true);
    expect(linkSummary(view)).toBe("Discord ✓ · Battle.net – · Characters ✓");
  });
  it("tells each missing step its next action", () => {
    const signedIn = { companionCredential: "personal" };
    expect(byId(linkSteps(signedIn, {}, hubWith({ battleNet: false })), "characters").next).toMatch(/Find my saved data/);
    expect(byId(linkSteps({ ...signedIn, watchFile: "g.lua" }, {}, hubWith({ battleNet: false })), "characters").next).toMatch(/\/reload/);
    expect(byId(linkSteps({ ...signedIn, watchFile: "g.lua" }, { lastUpload: {} }, hubWith({ battleNet: false })), "characters").next).toMatch(/\/guilded verify/);
  });
  it("copes with an older bot that sends no link information", () => {
    const view = linkSteps({ companionCredential: "personal" }, {}, hubWith(undefined));
    expect(byId(view, "battlenet").state).toBe("unknown");
    expect(byId(view, "battlenet").next).toMatch(/WoW Forever/);
  });
  it("does not ask leaderboards-only connections to prove characters", () => {
    const view = linkSteps({ companionCredential: "personal", personal: true }, {}, null);
    expect(byId(view, "characters").required).toBe(false);
    expect(view.complete).toBe(true);
  });
  it("has a French string for every status text", () => {
    const scenarios = [
      linkSteps({}, {}, null),
      linkSteps({ companionCredential: "c" }, {}, null),
      linkSteps({ companionCredential: "c", watchFile: "g.lua" }, {}, hubWith({ battleNet: false })),
      linkSteps({ companionCredential: "c", watchFile: "g.lua" }, { lastUpload: {} }, hubWith({ battleNet: true }, 1)),
      linkSteps({ companionCredential: "c", watchFile: "g.lua" }, { lastUpload: {} }, hubWith({ battleNet: false })),
      linkSteps({ companionCredential: "c", personal: true }, {}, null)
    ];
    for (const view of scenarios) for (const step of view.steps) for (const text of [step.label, step.next]) if (text) expect(fr[text], text).toBeTypeOf("string");
  });
});

describe("Link everything wiring", () => {
  it("reuses the existing sign-in, Battle.net and device IPC instead of new auth", () => {
    const app = read("companion-app/renderer/app.js"), link = read("companion-app/renderer/link-everything.js");
    expect(app).toMatch(/api\.signInStart\(readForm\(\)\)/);
    expect(app).toContain("bind('btnLinkSignIn'");
    expect(link).toContain("api.openBattleNet()");
    expect(link).toContain("api.openConnections()");
    expect(link).not.toMatch(/uploadToken|UPLOAD_TOKEN|fetch\(/);
  });
  it("lands a signed-out user on the page once, and Skip remembers", () => {
    const app = read("companion-app/renderer/app.js");
    expect(app).toMatch(/!all\.config\.companionCredential && !linkSkipped\(\) \? 'link' : 'status'/);
    expect(read("companion-app/renderer/link-everything.js")).toContain("guilded.companion.linkSkipped");
  });
  it("every id the page script uses exists in the page", () => {
    const html = read("companion-app/renderer/index.html");
    const script = read("companion-app/renderer/link-everything.js") + read("companion-app/renderer/app.js");
    for (const id of ["page-link", "linkList", "linkAllDone", "linkSummary", "linkResult", "btnLinkSignIn", "btnLinkFind", "btnLinkCheck", "btnLinkBattleNet", "btnLinkDevices", "btnLinkSkip", "linkSignInWaiting", "linkSignInCode", "linkSignInCodeLine", "linkSignInLink", "btnLinkSignInCancel"]) {
      expect(html, id).toContain(`id="${id}"`);
      if (id !== "page-link") expect(script, id).toContain(id);
    }
    expect(html).toContain('data-page="link"');
  });
  it("accepts the one new IPC channel with no arguments only", () => {
    expect(() => validateIpc("link-find-saved-data", [])).not.toThrow();
    expect(() => validateIpc("link-find-saved-data", ["x"])).toThrow();
    expect(read("companion-app/preload.cjs")).toContain('"link-find-saved-data"');
  });
  it("finds saved data only after sign-in and only when exactly one account has it", () => {
    const main = read("companion-app/main.cjs");
    const block = main.slice(main.indexOf('registerIpc("link-find-saved-data"'), main.indexOf('registerIpc("browse-poe-log"'));
    expect(block).toContain("if (!config.companionCredential)");
    expect(block).toContain("found.length !== 1");
  });
  it("the bot only adds Battle.net/character counts to the hub answer, behind the personal credential", () => {
    const api = read("src/companion-api.ts");
    expect(api).toMatch(/link: \{ battleNet: link\.battleNet, characters: link\.characters \}/);
    expect(api).not.toMatch(/COMPANION_UPLOAD_TOKEN|UPLOAD_TOKEN/);
  });
  it("parses as plain browser script", () => {
    expect(() => new Script(read("companion-app/renderer/link-everything.js"), { filename: "link-everything.js" })).not.toThrow();
  });
});
