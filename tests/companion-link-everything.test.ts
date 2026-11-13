import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linkSteps, linkSummary, characterRows, ALREADY_LINKED } from "../companion/link-everything.mjs";

const require = createRequire(import.meta.url);
const fr: Record<string, string> = require("../companion-app/locales/fr.json");
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
  it("the bot only adds Battle.net/character counts to the hub answer, behind the personal credential", () => {
    const api = read("src/companion-api.ts");
    expect(api).toContain("link: { battleNet: link.battleNet, characters: link.characters, battleTag }");
    expect(api).not.toMatch(/COMPANION_UPLOAD_TOKEN|UPLOAD_TOKEN/);
  });
});
