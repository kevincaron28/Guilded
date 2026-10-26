import { describe, expect, it } from "vitest";
import { deleteLine, editLine, logMessageDelete, logMessageEdit } from "../src/services/message-log.js";
import { starboardPayload, visibleEnough } from "../src/services/starboard.js";
import { keyLevelFromTitle, teamAttendance } from "../src/services/guild-tools-store.js";
import { filterGroupPosts } from "../src/services/guild-tools-pages.js";
import { profileDescription, type PlayerProfile } from "../src/services/player-profiles.js";
import { communityCard } from "../src/commands/community.js";

describe("starboard", () => {
  it("reposts only messages every starboard reader could already see", () => {
    expect(visibleEnough([{ readsStarboard: true, readsSource: true }, { readsStarboard: false, readsSource: false }])).toBe(true);
    expect(visibleEnough([{ readsStarboard: true, readsSource: true }, { readsStarboard: true, readsSource: false }])).toBe(false);
  });
  it("shows the stars, channel, author and a jump link without pinging", () => {
    const payload = starboardPayload({ stars: 5, authorId: "9", guildId: "1", channelId: "2", messageId: "3", text: "gz on the kill", image: null, lang: "fr" });
    expect(payload.content).toBe("⭐ **5** · <#2> · <@9>");
    expect(payload.embeds[0]!.data.description).toBe("gz on the kill\n\n[Aller au message](https://discord.com/channels/1/2/3)");
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });
});

describe("message log", () => {
  it("quotes before and after, clipped", () => {
    const line = editLine({ authorId: "9", channelId: "2", url: "https://discord.com/channels/1/2/3", before: "a".repeat(800), after: "fixed" });
    expect(line).toContain("✏️ Message edited by <@9> in <#2>");
    expect(line).toContain(`> ${"a".repeat(700)}…`);
    expect(line).toContain("**After**\n> fixed");
    expect(deleteLine({ authorId: "9", channelId: "2", text: "", attachments: ["boss.png"] })).toBe("🗑️ Message by <@9> deleted in <#2>\n> *(no text)*\n📎 boss.png");
  });
  it("skips what it can't compare or shouldn't log, before touching the database", async () => {
    const guild = { id: "1" };
    await expect(logMessageEdit({ partial: true } as never, { guild, author: { bot: false } } as never)).resolves.toBeUndefined();
    await expect(logMessageEdit({ partial: false, content: "" } as never, { guild, author: { bot: false }, content: "x" } as never)).resolves.toBeUndefined();
    await expect(logMessageEdit({ partial: false, content: "same" } as never, { guild, author: { bot: false }, content: "same" } as never)).resolves.toBeUndefined();
    await expect(logMessageDelete({ guild, author: { bot: true } } as never)).resolves.toBeUndefined();
    await expect(logMessageDelete({ guild, author: null } as never)).resolves.toBeUndefined();
  });
});

describe("guild tool pages", () => {
  it("reads a keystone level from a group title", () => {
    expect(["Ara-Kara +12", "+7 Dawnbreaker", "M+ 15 Priory", "Stonevault key 9", "clé 10 Cinderbrew", "Deadmines", "Raid 2+3", "+1 run"].map(keyLevelFromTitle))
      .toEqual([12, 7, 15, 9, 10, null, null, null]);
  });
  it("filters groups by minimum key level, leaving out groups without one", () => {
    const row = (title: string, keyLevel: number | null) => ({ title, keyLevel, kind: "DUNGEON", minLevel: null, maxLevel: null, createdAt: new Date(), size: 5, signedUp: 2, missing: { TANK: 1, HEALER: 1, DPS: 1 }, url: null });
    const rows = [row("Ara +12", 12), row("Floodgate +8", 8), row("Normal run", null)];
    expect(filterGroupPosts(rows, "", "", 10).map((r) => r.title)).toEqual(["Ara +12"]);
    expect(filterGroupPosts(rows, "", "").length).toBe(3);
  });
  it("counts a member's attendance over the team's own recent raids; no record is a miss", () => {
    const raid = (status?: string) => ({ attendance: status ? [{ memberId: "m", status }, { memberId: "other", status: "PRESENT" }] : [] });
    expect(teamAttendance([raid("PRESENT"), raid("LATE"), raid("BENCHED"), raid("ABSENT"), raid()], "m")).toEqual({ raids: 5, attended: 3, late: 1 });
    expect(teamAttendance([], "m")).toBeNull();
    expect(teamAttendance(Array.from({ length: 12 }, () => raid("PRESENT")), "m")?.raids).toBe(8);
  });
  it("leads a profile's link preview with the best public score", () => {
    const t = (en: string) => en;
    const profile = (runs: PlayerProfile["runs"]): PlayerProfile => ({ id: "p", name: "Kev", public: true, characters: [{ name: "Thrall", realm: "R", source: "guild" }], runs });
    expect(profileDescription(profile([]), t)).toBe("Kev: 1 character(s) and public dungeon runs on Guilded.");
  });
});

describe("lottery wording", () => {
  it("says 1 participant and 1 confirmed ticket", () => {
    const season = { id: "s", guildId: "g", game: "WOW", name: "S1", status: "ACTIVE", channelId: null } as never;
    const row = { id: "a", seasonId: "s", season, kind: "LOTTERY", title: "Draw", rules: { mode: "FREE", cost: 0, prize: "Mount", currency: "", realm: "", winners: 1, maxTickets: 1 }, status: "OPEN", startsAt: null, endsAt: new Date(Date.now() + 86_400_000), createdBy: "o", createdAt: new Date(), messageId: null, postedChannelId: null, reminderAt: null, result: null };
    const description = communityCard(row as never, [{ userId: "u", quantity: 1, status: "CONFIRMED" }], "en").embeds[0]!.data.description!;
    expect(description).toContain("1 participant · 1 confirmed ticket · 1 winner(s)");
    expect(communityCard(row as never, [{ userId: "u", quantity: 1, status: "CONFIRMED" }], "fr").embeds[0]!.data.description).toContain("1 participant · 1 billet confirmé");
  });
});
