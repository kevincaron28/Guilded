import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { discordInvite, openRaidSpots, publicRaidMatches, publicRaids } from "../src/services/public-raids.js";
import { readFilters } from "../src/services/recruitment.js";
import { createWebApp } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";
import { pugBoardPayload, refreshPugBoard } from "../src/services/pug-board.js";
import { EmbedBuilder, type Guild } from "discord.js";

const now = new Date("2026-10-20T18:00:00Z");
function row(over = {}) {
  return { id: "raid", title: "Molten Core <script>", scheduledAt: new Date("2026-10-21T18:00:00Z"),
    tankLimit: 2, healerLimit: 3, dpsLimit: null, publicPug: true, isTest: false, status: "PLANNED",
    pugRealm: "Forever", pugFaction: "HORDE", pugLanguage: "fr", pugInviteUrl: "https://discord.gg/host",
    signupChannelId: "222", signupMessageId: "333", guild: { discordId: "111", name: "Host" }, core: { name: "Core" },
    signups: [{ role: "TANK", status: "SIGNED_UP" }, { role: "HEALER", status: "MAYBE" }], ...over };
}
function db(rows = [row()]) {
  return { raid: { findMany: vi.fn(async () => rows) } };
}
const asDb = (database: unknown) => database as PrismaClient;

describe("public raid vacancies", () => {
  it("counts confirmed players only, clamps overbookings, and never invents uncapped vacancies", () => {
    expect(openRaidSpots({ tankLimit: 1, healerLimit: 2, dpsLimit: null, signups: [
      { role: "TANK", status: "SIGNED_UP" }, { role: "TANK", status: "SIGNED_UP" },
      { role: "HEALER", status: "MAYBE" }, { role: "HEALER", status: "WAITLISTED" },
      { role: "HEALER", status: "CANCELLED" }, { role: "DPS", status: "SIGNED_UP" }
    ] })).toEqual({ TANK: 0, HEALER: 2, DPS: 0 });
  });
  it("only queries explicitly shared upcoming non-test planned raids, and exports no roster", async () => {
    const database = db();
    const result = await publicRaids(asDb(database), () => true, now);
    expect(database.raid.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      publicPug: true, isTest: false, status: "PLANNED", scheduledAt: { gt: now, lte: new Date("2026-11-19T18:00:00Z") }
    }) }));
    expect(result[0]).toMatchObject({ spots: { TANK: 1, HEALER: 3, DPS: 0 }, signupUrl: "https://discord.com/channels/111/222/333" });
    expect(JSON.stringify(result)).not.toMatch(/signups|character|memberId|description/);
    const selected = database.raid.findMany.mock.calls[0] as unknown as [{ select: { signups: unknown } }];
    expect(selected[0].select.signups).toEqual({ select: { role: true, status: true } });
  });
  it("removes unapproved, full, unlinked and invalid-invite raids", async () => {
    expect(await publicRaids(asDb(db()), () => false, now)).toEqual([]);
    for (const patch of [
      { tankLimit: 1, healerLimit: 0 }, { signupMessageId: null }, { pugRealm: "" },
      { pugInviteUrl: "javascript:alert(1)" }, { pugInviteUrl: "https://discord.gg.evil.test/foo" }
    ]) expect(await publicRaids(asDb(db([row(patch)])), () => true, now)).toEqual([]);
    expect(discordInvite("https://discord.com/invite/abc")).toBeTruthy();
  });
  it("updates role availability as the same authoritative roster changes", async () => {
    const raid = row();
    const database = db([raid]);
    expect((await publicRaids(asDb(database), () => true, now))[0]!.spots.TANK).toBe(1);
    raid.signups.push({ role: "TANK", status: "SIGNED_UP" });
    expect((await publicRaids(asDb(database), () => true, now))[0]!.spots.TANK).toBe(0);
    raid.signups[0]!.status = "CANCELLED";
    expect((await publicRaids(asDb(database), () => true, now))[0]!.spots.TANK).toBe(1);
  });
  it("filters by role, faction, language and realm, separately from core recruitment", async () => {
    const raid = (await publicRaids(asDb(db()), () => true, now))[0]!;
    expect(publicRaidMatches(raid, readFilters(new URLSearchParams("kind=raids&role=healer&realm=forever&language=fr&faction=HORDE")))).toBe(true);
    for (const query of ["role=dps", "faction=ALLIANCE", "language=en", "realm=Other", "kind=core"])
      expect(publicRaidMatches(raid, readFilters(new URLSearchParams(query)))).toBe(false);
  });
  it("renders public raid links even with sign-in off, escapes text, and excludes blocked servers", async () => {
    const raids = await publicRaids(asDb(db()), () => true, now);
    const app = createWebApp({ store: memoryWebStore().store, auth: null, allows: id => id === "111",
      publicRaids: async () => [...raids, { ...raids[0]!, guildDiscordId: "blocked", title: "Private test" }], postApplication: async () => null });
    const page = await app.respond({ method: "GET", path: "/recruitment/", query: new URLSearchParams("kind=raids&lang=fr"), headers: {} });
    expect(page!.body).toContain("Molten Core &lt;script&gt;");
    expect(page!.body).toContain('href="https://discord.gg/host"');
    expect(page!.body).not.toContain("Private test");
    expect(page!.body).not.toContain("Recrutent en ce moment");
  });
});

describe("Discord open raid board", () => {
  it("edits one board and clears filled raids without creating duplicate posts", async () => {
    const database = db();
    const edit = vi.fn(async () => undefined);
    const send = vi.fn();
    const channel = { isTextBased: () => true, send, messages: { fetch: vi.fn(async () => ({ edit })) } };
    Object.assign(database, { guild: { findUnique: vi.fn(async () => ({ id: "g", settings: { pugChannelId: "c", pugMessageId: "m", language: "en" } })) } });
    const guild = { id: "other", channels: { fetch: vi.fn(async () => channel) } } as unknown as Guild;
    await refreshPugBoard(guild, asDb(database), () => true, now);
    expect(edit).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    database.raid.findMany.mockResolvedValue([]);
    await refreshPugBoard(guild, asDb(database), () => true, now);
    const payload = edit.mock.calls.at(-1) as unknown as [{ embeds: { toJSON(): { fields: { name: string }[] } }[] }];
    expect(payload[0].embeds[0]!.toJSON().fields[0]!.name).toBe("No open spots");
  });
  it("bounds board size and disables all mentions", async () => {
    const raid = (await publicRaids(asDb(db()), () => true, now))[0]!;
    const payload = pugBoardPayload(Array.from({ length: 50 }, () => raid), "en", now);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(EmbedBuilder.from(payload.embeds![0]!).toJSON().fields).toHaveLength(8);
  });
});
