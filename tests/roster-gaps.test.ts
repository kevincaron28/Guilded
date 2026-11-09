import { describe, expect, it } from "vitest";
import { formatRosterGaps, inviteLines, inviteName, planRosterGaps, type GapCharacter, type GapDiscordMember } from "../src/services/roster-gaps.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const member = (id: string, extra: Partial<GapDiscordMember> = {}): GapDiscordMember => ({ discordUserId: id, displayName: id.toUpperCase(), isBot: false, roleIds: [], ...extra });
const character = (id: string, name: string, extra: Partial<GapCharacter> = {}): GapCharacter => ({ discordUserId: id, name, isMain: true, guildRankAt: days(1), ...extra });

describe("roster gaps", () => {
  it("lists linked members whose characters are not in the guild, with full-name /ginvite lines", () => {
    const gaps = planRosterGaps({ now: NOW, syncFresh: true,
      members: [member("a"), member("b"), member("c"), member("d")],
      characters: [character("a", "Halidor Galemorne"), character("b", "Highpriest Cheech", { guildRankAt: days(20) }), character("b", "Alt Person", { isMain: false, guildRankAt: null }), character("d", "Never Synced", { guildRankAt: null })],
      unclaimed: [] });
    expect(gaps.notInGuild.map((row) => row.displayName)).toEqual(["B", "D"]);
    expect(inviteLines(gaps.notInGuild)).toEqual(["/ginvite Highpriest Cheech", "/ginvite Never Synced"]);
    expect(gaps.notInGuild[0]!.others).toEqual(["Alt Person"]);
    expect(gaps.noLink.map((row) => row.displayName)).toEqual(["C"]);
  });
  it("ignores bots and officer-chosen roles", () => {
    const gaps = planRosterGaps({ now: NOW, syncFresh: true, ignoredRoleIds: ["guest"],
      members: [member("bot", { isBot: true }), member("g", { roleIds: ["guest"] }), member("x", { roleIds: ["member"] })], characters: [], unclaimed: [] });
    expect(gaps.noLink.map((row) => row.discordUserId)).toEqual(["x"]);
    expect(gaps.considered).toBe(1);
  });
  it("shows only guild characters seen within 14 days as unclaimed", () => {
    const gaps = planRosterGaps({ now: NOW, syncFresh: true, members: [], characters: [],
      unclaimed: [{ name: "Fresh One", className: "Mage", level: 12, lastSeenAt: days(2) }, { name: "Long Gone", className: "Rogue", level: 60, lastSeenAt: days(40) }] });
    expect(gaps.unclaimed).toEqual([{ name: "Fresh One", className: "Mage", level: 12 }]);
  });
  it("keeps invite names on one line and warns when no officer upload is recent", () => {
    expect(inviteName("Bad`\nName  Here")).toBe("Bad Name Here");
    const text = formatRosterGaps(planRosterGaps({ now: NOW, syncFresh: false, members: [member("a")], characters: [character("a", "Old Timer", { guildRankAt: null })], unclaimed: [] }), "fr");
    expect(text.text).toContain("⚠️");
    expect(text.text).toContain("`/ginvite Old Timer`");
    expect(text.invites).toBe("/ginvite Old Timer");
  });
  it("keeps 300 members under Discord's message limit and still copies every line", () => {
    const members = Array.from({ length: 300 }, (_, i) => member(`m${i}`, { displayName: `Member number ${i}` }));
    const characters = members.map((m, i) => character(m.discordUserId, `First${i} Last${i}`, { guildRankAt: null }));
    const out = formatRosterGaps(planRosterGaps({ now: NOW, syncFresh: true, members, characters, unclaimed: [] }), "en");
    expect(out.text.length).toBeLessThanOrEqual(1900);
    expect(out.invites.split("\n")).toHaveLength(300);
  });
});
