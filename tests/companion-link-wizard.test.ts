import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { linkWizard, savedSince, successKey } from "../companion/link-wizard.mjs";
import { linkedAsLua } from "../companion/standings-format.mjs";

// 8.5 Track L, effortless linking: the 3-step wizard, the status levels and the in-game line.
const require = createRequire(import.meta.url);
const identity = require("../companion-app/link-identity.cjs");
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;
const me = (join: unknown = null) => ({ ok: true, account: { username: "kev", displayName: "Kev", avatarUrl: null }, personal: true, servers: [], join });
const ids = (wizard: ReturnType<typeof linkWizard>) => wizard.steps.map((step) => `${step.id}:${step.state}`);

describe("link wizard steps", () => {
  it("starts at Discord, then the guild's server, then the characters", () => {
    expect(ids(linkWizard({}))).toEqual(["discord:current", "server:todo", "characters:todo"]);
    expect(ids(linkWizard({ config: { companionCredential: "c", personal: true }, me: me() }))).toEqual(["discord:done", "server:current", "characters:todo"]);
    expect(ids(linkWizard({ config: { companionCredential: "c" }, hub: { characters: [] } }))).toEqual(["discord:done", "server:done", "characters:current"]);
    const done = linkWizard({ config: { companionCredential: "c" }, hub: { guild: { name: "Québec Gold" }, characters: [{ name: "Ann", displayName: "Ann Smith" }] } });
    expect(ids(done)).toEqual(["discord:done", "server:done", "characters:done"]);
    expect(done.current).toBeNull();
  });

  it("not in the guild's Discord: Join, then continue by itself once joined", () => {
    const signed = { companionCredential: "c", personal: true };
    expect(linkWizard({ config: signed, me: me({ serverName: "Québec Gold", inviteUrl: "https://discord.gg/qg", joined: false }) }).join)
      .toMatchObject({ kind: "invite", server: "Québec Gold", inviteUrl: "https://discord.gg/qg" });
    expect(linkWizard({ config: signed, me: me({ serverName: "Québec Gold", inviteUrl: "https://discord.gg/qg", joined: true }) }).join?.kind).toBe("joined");
    expect(linkWizard({ config: signed, me: me({ serverName: "Québec Gold", inviteUrl: null, joined: false }) }).join?.kind).toBe("ask");
    expect(linkWizard({ config: signed, me: me() }).join?.kind).toBe("unknown");
    expect(linkWizard({ config: { companionCredential: "c" }, me: me() }).join).toBeNull();
  });

  it("shows who is signed in", () => {
    expect(linkWizard({ config: { companionCredential: "c" }, me: me() }).identity).toMatchObject({ username: "kev" });
    expect(linkWizard({ config: {}, me: me() }).identity).toBeNull();
  });

  it("explains where characters come from and checks each piece", () => {
    const wizard = linkWizard({ config: { companionCredential: "c", watchFile: "Guilded.lua" }, hub: { characters: [] }, problems: [{ id: "addon-missing" }], state: {} });
    expect(wizard.charactersHelp).toMatchObject({ canDetect: true });
    expect(wizard.diagnostics.map((check) => `${check.ok ? "ok" : "no"}:${check.text}`)).toEqual([
      "ok:Guilded's server answers", "ok:Your WoW folder is chosen", "no:The Guilded addon is installed", "ok:WoW saved your Guilded data", "no:The companion sent your data"
    ]);
    expect(linkWizard({ config: { companionCredential: "c" }, hub: { characters: [] }, problems: [{ id: "bot-unreachable" }] }).diagnostics[0]).toMatchObject({ ok: false });
  });

  it("the success screen names the characters like the Discord DM, at most 10", () => {
    const characters = Array.from({ length: 12 }, (_, index) => ({ name: `C${index}` }));
    expect(linkWizard({ config: { companionCredential: "c" }, hub: { guild: { name: "Québec Gold" }, characters } }).success).toEqual({ server: "Québec Gold", names: characters.slice(0, 10).map((c) => c.name), more: 2 });
    expect(successKey({ guildDiscordId: "111" }, me())).toBe("111:kev");
  });

  it("Detect now waits for a save after the button was pressed", () => {
    expect(savedSince({ changedAt: "2026-11-06T18:01:00Z" }, "2026-11-06T18:00:00Z")).toBe("2026-11-06T18:01:00Z");
    expect(savedSince({ changedAt: "2026-11-06T17:59:00Z" }, "2026-11-06T18:00:00Z")).toBeNull();
    expect(savedSince(null, "2026-11-06T18:00:00Z")).toBeNull();
  });

  it("has French for every wizard text", () => {
    const scenarios = [
      linkWizard({}),
      linkWizard({ config: { companionCredential: "c", personal: true }, me: me({ serverName: "Q", inviteUrl: "https://discord.gg/q", joined: false }) }),
      linkWizard({ config: { companionCredential: "c", personal: true }, me: me({ serverName: "Q", inviteUrl: null, joined: false }) }),
      linkWizard({ config: { companionCredential: "c", personal: true }, me: me({ serverName: "Q", inviteUrl: null, joined: true }) }),
      linkWizard({ config: { companionCredential: "c", personal: true }, me: me() }),
      linkWizard({ config: { companionCredential: "c" }, hub: { characters: [] }, problems: [{ id: "bot-unreachable" }, { id: "addon-missing" }] })
    ];
    for (const wizard of scenarios) {
      const texts = [...wizard.steps.map((step) => step.label), wizard.join?.text[0], wizard.charactersHelp?.text, ...wizard.diagnostics.flatMap((check) => [check.text, check.fix])];
      for (const text of texts) if (text) expect(fr[text], text).toBeTypeOf("string");
    }
  });
});

describe("status levels: Guilded's outages are never the member's red", () => {
  const running = { running: true };
  it("a bot restart reads as amber waiting", () => {
    expect(identity.companionHealth({ state: { ...running, uploadError: "Could not reach the bot. Is it running, and is the bot address right?" } })).toMatchObject({ level: "setup", serverSide: true });
    expect(identity.companionHealth({ state: { ...running, uploadError: "Upload failed (503): The guild bot is temporarily unavailable." } })).toMatchObject({ level: "setup" });
  });
  it("upload OK with rankings delayed is a partial success", () => {
    expect(identity.companionHealth({ state: { ...running, standingsError: "Standings request failed (502): The guild bot is temporarily unavailable. Standings will retry automatically." } }))
      .toEqual({ level: "ok", partial: true, text: identity.RANKINGS_DELAYED });
  });
  it("a problem the member can fix stays red, and setup comes first", () => {
    expect(identity.companionHealth({ state: { ...running, uploadError: "Pair this companion with /character pair." } })).toMatchObject({ level: "error" });
    expect(identity.companionHealth({ setupProblems: 1, state: running })).toMatchObject({ level: "setup", text: "Setup needed" });
    expect(identity.companionHealth({ state: {} })).toMatchObject({ level: "error", text: "Not running" });
    expect(identity.companionHealth({ state: running })).toMatchObject({ level: "ok" });
  });
  it("the red badge counts only problems the member can fix", () => {
    expect(identity.memberProblems([{ id: "bot-unreachable" }, { id: "addon-missing" }])).toEqual([{ id: "addon-missing" }]);
  });
  it("has French for the new status texts", () => {
    for (const text of [identity.SERVER_WAIT, identity.RANKINGS_DELAYED]) expect(fr[text], text).toBeTypeOf("string");
  });
});

describe("the in-game guild and the linked line", () => {
  it("reads the guild the addon saved", () => {
    expect(identity.guildFromSavedText('GuildedDB = {\n["guildKey"] = "Québec Gold-Forever",\n}')).toEqual({ name: "Québec Gold", realm: "Forever" });
    expect(identity.guildFromSavedText('["guildKey"] = "Les Gardiens-Azjol-Nerub"')).toEqual({ name: "Les Gardiens", realm: "Azjol-Nerub" });
    expect(identity.guildFromSavedText("GuildedDB = {}")).toBeNull();
    expect(identity.guildFromSavedText('["guildKey"] = "NoRealm"')).toBeNull();
  });
  it("writes only a plain name for the addon", () => {
    expect(linkedAsLua({ username: "kev", displayName: "Kev" })).toBe('GuildedLinkedAs = "Kev"\n');
    expect(linkedAsLua({ username: "kev", displayName: null })).toBe('GuildedLinkedAs = "kev"\n');
    expect(linkedAsLua({ displayName: 'a"b|c\n' })).toBe('GuildedLinkedAs = "abc"\n');
    expect(linkedAsLua(undefined)).toBe("GuildedLinkedAs = nil\n");
  });
});
