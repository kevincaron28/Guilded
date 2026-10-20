import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { publicRaidsToLua } from "../../companion/standings-format.mjs";

let session: LuaSession | undefined;
afterEach(() => session?.close());
const snapshot = {
  fetchedAt: "2026-10-20T18:00:00Z",
  raids: [{ id: "r", title: 'Raid "quotes" \\ path |Hbad', guildName: "Host", coreName: "Core", scheduledAt: "2026-10-20T19:00:00Z",
    realm: "Forever", faction: "HORDE", language: "fr", spots: { TANK: 0, HEALER: 2, DPS: 1 },
    signupUrl: "https://discord.com/channels/1/2/3", inviteUrl: "https://discord.gg/host" }]
};
function setup() {
  session = newLuaSession();
  session.run(`NS = { commandHandlers = {}, commandHelp = {}, L = function(t) return t end,
    showCopyText = function(t) COPIED = t end, openToolsPage = function(t) OPENED = t end }
    NOW = ${Date.parse(snapshot.fetchedAt) / 1000}
    function GetServerTime() return NOW end`);
  session.load("Util.lua");
  session.load("Modules/PublicRaids.lua");
  session.run(publicRaidsToLua(snapshot).join("\n"));
  return session;
}
describe("public raid snapshot in the real addon", () => {
  it("loads escaped companion output and filters by role and realm", () => {
    const s = setup();
    expect(s.run('return #NS.publicRaids.rows("healers", "forever")')).toBe("1");
    expect(s.run('return #NS.publicRaids.rows("tanks")')).toBe("0");
    expect(s.run('return #NS.publicRaids.rows(nil, "Other")')).toBe("0");
    expect(s.run("return NS.publicRaids.statusText()")).toContain('Raid "quotes" \\ path Hbad');
  });
  it("hides old, future-dated, missing, and started snapshots", () => {
    const s = setup();
    s.run("NOW = NOW + 601");
    expect(s.run("return #NS.publicRaids.rows()")).toBe("0");
    expect(s.run("return NS.publicRaids.statusText()")).toContain("fresh companion");
    s.run("NOW = NOW - 700");
    expect(s.run("return #NS.publicRaids.rows()")).toBe("0");
    s.run('NOW = NOW + 99; GuildedPublicRaids.raids[1].at = GuildedPublicRaids.fetchedAt');
    expect(s.run("return #NS.publicRaids.rows()")).toBe("0");
    s.run("GuildedPublicRaids = nil");
    expect(s.run("return #NS.publicRaids.rows()")).toBe("0");
  });
  it("opens the browser for members and copies a host link, never sends an invitation", () => {
    const s = setup();
    s.run('NS.commandHandlers.pug({})');
    expect(s.run("return OPENED")).toBe("Open raids");
    s.run('NS.commandHandlers.pug({"copy", "1"})');
    expect(s.run("return COPIED")).toBe("https://discord.gg/host");
    s.run('NOW = NOW + 700; NS.commandHandlers.pug({"copy", "1"})');
    expect(s.run("return COPIED")).toContain("/recruitment/?kind=raids");
    expect(s.run("return tostring(SENT == nil)")).toBe("true");
  });
});
