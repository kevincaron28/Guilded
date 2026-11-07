import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { linkSteps, linkSummary, characterRows, ALREADY_LINKED } from "../companion/link-everything.mjs";

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
    expect(byId(linkSteps(signedIn, {}, hubWith({ battleNet: false })), "characters").next).toMatch(/Find my addon data/);
    expect(byId(linkSteps({ ...signedIn, watchFile: "g.lua" }, {}, hubWith({ battleNet: false })), "characters").next).toMatch(/\/reload/);
    expect(byId(linkSteps({ ...signedIn, watchFile: "g.lua" }, { lastUpload: {} }, hubWith({ battleNet: false })), "characters").next).toMatch(/\/character claim/);
  });
  it("copes with an older bot that sends no link information", () => {
    const view = linkSteps({ companionCredential: "personal" }, {}, hubWith(undefined));
    expect(byId(view, "battlenet").state).toBe("unknown");
    expect(byId(view, "battlenet").next).toMatch(/WoW Forever/);
  });
  it("shows an already-linked account in plain words, as who it is linked to", () => {
    const hub = { guild: { name: "Vanguard" }, link: { battleNet: true, battleTag: "Kev#1234" }, characters: [{ name: "Aria" }, { name: "Bo" }] };
    const view = linkSteps({ companionCredential: "c", watchFile: "g.lua" }, { lastUpload: {} }, hub);
    expect(byId(view, "discord")).toMatchObject({ state: "done", label: "Discord linked to {0}", args: ["Vanguard"] });
    expect(byId(view, "battlenet")).toMatchObject({ state: "done", label: "Battle.net linked as {0}", args: ["Kev#1234"] });
    expect(byId(view, "characters")).toMatchObject({ state: "done", label: "{0} character(s) linked", args: [2] });
    expect(view.complete).toBe(true);
    expect(view.nextStep).toBeNull();
    expect(ALREADY_LINKED).toBe("Already linked, nothing to do.");
    expect(fr[ALREADY_LINKED]).toBeTypeOf("string");
  });
  it("says what to do when Discord is linked but no character is found yet", () => {
    const view = linkSteps({ companionCredential: "c", watchFile: "g.lua" }, {}, { guild: { name: "V" }, link: { battleNet: false }, characters: [] });
    expect(byId(view, "discord").state).toBe("done");
    expect(byId(view, "characters").next).toBe("Log in to WoW once and we will find your characters. Type /reload or log out so your data is saved.");
    expect(view.complete).toBe(false);
    expect(view.nextStep?.id).toBe("characters");
  });
  it("lists characters with guild, rank, Discord server and link state", () => {
    const rows = characterRows({ characters: [{ name: "Aria", displayName: "Aria Stone", realm: "Doomhowl", edition: "forever", rank: "Officer", guild: { name: "Vanguard", serverName: "Vanguard HQ" } }, { name: "Bo", realm: "R", edition: "retail", guild: { name: "Other" } }] });
    expect(rows[0]).toEqual({ name: "Aria Stone", realm: "Doomhowl · forever", wowGuild: "Vanguard", rank: "Officer", server: "Vanguard HQ", linked: true });
    expect(rows[1]).toMatchObject({ rank: "", server: "" });
    expect(characterRows(null)).toEqual([]);
  });
  it("uses no technical words in the member-facing texts", () => {
    const html = read("companion-app/renderer/index.html");
    const page = html.slice(html.indexOf('id="page-link"'), html.indexOf('id="page-wow"'));
    for (const word of [/token/i, /oauth/i, /credential/i]) expect(page).not.toMatch(word);
    expect(read("companion/link-everything.mjs").replace(/\/\/.*$/gm, "")).not.toMatch(/token|oauth|credential"/i);
  });
  it("leaderboards only: says no guild server yet, never that everything is linked (8.5 fresh-PC test)", () => {
    const view = linkSteps({ companionCredential: "personal", personal: true }, {}, null);
    expect(byId(view, "characters").required).toBe(false);
    expect(view.complete).toBe(false);
    expect(byId(view, "discord").label).toBe("Signed in for public dungeon rankings only");
    expect(byId(view, "characters")).toMatchObject({ state: "todo", label: "No guild server yet" });
    expect(byId(view, "characters").next).toMatch(/not in a Discord server that uses Guilded yet/);
  });
  it("never reports complete with no character linked", () => {
    for (const config of [{ companionCredential: "c", watchFile: "g.lua" }, { companionCredential: "c", personal: true }]) {
      expect(linkSteps(config, { lastUpload: {} }, hubWith({ battleNet: true }, 0)).complete).toBe(false);
    }
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
  it("opens on the page, and Skip remembers, and Skip remembers", () => {
    const app = read("companion-app/renderer/app.js");
    expect(app).toContain("!linkSkipped() ? 'link' : 'status'");
    expect(read("companion-app/renderer/link-everything.js")).toContain("guilded.companion.linkSkipped");
  });
  it("every id the page script uses exists in the page", () => {
    const html = read("companion-app/renderer/index.html");
    const script = read("companion-app/renderer/link-everything.js") + read("companion-app/renderer/app.js");
    for (const id of ["page-link", "linkList", "linkAllDone", "linkSummary", "linkResult", "btnLinkSignIn", "btnLinkFind", "btnLinkCheck", "btnLinkBattleNet", "btnLinkDevices", "btnLinkSkip", "linkSignInWaiting", "linkSignInCode", "linkSignInCodeLine", "linkSignInTimeLeft", "btnLinkSignInReopen", "btnLinkSignInCancel", "linkChars", "linkCharCount", "linkCharsEmpty", "btnLinkSync", "btnLinkUnlink", "btnLinkDiscord", "linkCharsPanel", "linkActionsPanel"]) {
      expect(html, id).toContain(`id="${id}"`);
      if (id !== "page-link") expect(script, id).toContain(id);
    }
    expect(html).toContain('data-go="link"'); // Settings > Run setup again (the menu entry left in redesign PR 2)
  });
  it("re-running a linked step is a harmless no-op", () => {
    const app = read("companion-app/renderer/app.js"), link = read("companion-app/renderer/link-everything.js");
    expect(app).toMatch(/view === 'link' && savedConfig\.companionCredential && !savedConfig\.personal\) \{ ui\.say\(T\("Already linked, nothing to do\."\)/);
    expect(link.match(/Already linked, nothing to do\./g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("opens the Discord server only for a numeric server id", () => {
    const main = read("companion-app/main.cjs");
    expect(main).toContain("https://discord.com/channels/${config.guildDiscordId}");
    expect(main).toContain("{5,25}");
    expect(() => validateIpc("open-discord-server", [])).not.toThrow();
    expect(() => validateIpc("open-discord-server", ["x"])).toThrow();
  });
  it("accepts the one new IPC channel with no arguments only", () => {
    expect(() => validateIpc("link-find-saved-data", [])).not.toThrow();
    expect(() => validateIpc("link-find-saved-data", ["x"])).toThrow();
    expect(read("companion-app/preload.cjs")).toContain('"link-find-saved-data"');
  });
  it("finds saved data only after sign-in and only when it can tell which file is the live one", () => {
    const main = read("companion-app/main.cjs");
    const block = main.slice(main.indexOf('registerIpc("link-find-saved-data"'), main.indexOf('registerIpc("browse-poe-log"'));
    expect(block).toContain("if (!config.companionCredential)");
    // The only file, or the only WoW Forever file; otherwise the member chooses.
    expect(block).toContain("pickSavedVariables(found)");
    expect(block).toContain("if (!chosen)");
    // A missing, beta or stale watched file is looked for again instead of "already linked".
    expect(block).toContain("!current.candidate");
  });
  it("the bot only adds Battle.net/character counts to the hub answer, behind the personal credential", () => {
    const api = read("src/companion-api.ts");
    expect(api).toContain("link: { battleNet: link.battleNet, characters: link.characters, battleTag }");
    expect(api).not.toMatch(/COMPANION_UPLOAD_TOKEN|UPLOAD_TOKEN/);
  });
  it("parses as plain browser script", () => {
    expect(() => new Script(read("companion-app/renderer/link-everything.js"), { filename: "link-everything.js" })).not.toThrow();
  });
});

describe("companion renderer startup", () => {
  // A bind() on an id that is not in the page throws while app.js loads and stops the whole window
  // (btnOnline did, after the browser companion was removed).
  it("every bind('id') and $('id') in app.js exists in index.html", () => {
    const html = read("companion-app/renderer/index.html");
    const ids = new Set([...read("companion-app/renderer/app.js").matchAll(/(?:bind|\$)\('([A-Za-z0-9_-]+)'/g)].map(match => match[1]));
    const dynamic = new Set(["syncEvidence"]);
    for (const id of ids) if (!dynamic.has(id!)) expect(html, id).toContain(`id="${id}"`);
  });
});
