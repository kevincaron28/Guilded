import { describe, expect, it, vi } from "vitest";
import { loadPvpGroups, lookingEmbed, parsePvpForm, pvpGroupLine, PVP_DEFAULT_SIZE, type PvpGroupView } from "../src/services/pvp-group.js";
import { createDungeonGroupService } from "../src/services/dungeon-group.js";
import { bgSetupPanel } from "../src/services/battleground-setup.js";

const view = (over: Partial<PvpGroupView> = {}): PvpGroupView => ({ id: "g1", title: "WSG at 9pm", size: 10, createdAt: new Date("2026-11-06T12:00:00Z"), started: false,
  members: ["Aria", "Brom"], waiting: [], link: "https://discord.com/channels/1/2/3", minLevel: 60, maxLevel: 60, ...over });

describe("PvP group form", () => {
  it("defaults the size to 10, clamps 2-40 and reads levels", () => {
    expect(parsePvpForm({ title: "  WSG   tonight " })).toEqual({ title: "WSG tonight", size: PVP_DEFAULT_SIZE, minLevel: null, maxLevel: null });
    expect(parsePvpForm({ title: "AB 9pm", size: "99", levels: "55+" })).toMatchObject({ size: 40, minLevel: 55, maxLevel: 80 });
    expect(parsePvpForm({ title: "AB 9pm", size: "1", levels: "10-19" })).toMatchObject({ size: 2, minLevel: 10, maxLevel: 19 });
    expect(parsePvpForm({ title: "AB 9pm", size: "abc" }).size).toBe(10);
  });
  it("rejects a title that is too short or too long", () => {
    expect(() => parsePvpForm({ title: "ab" })).toThrow("3 to 80");
    expect(() => parsePvpForm({ title: "x".repeat(81) })).toThrow("3 to 80");
  });
});

describe("who's looking", () => {
  it("lists each open group with its roster, waitlist and a link, in both languages", () => {
    const en = pvpGroupLine(view({ waiting: ["Cleo"] }), "en");
    expect(en).toContain("**WSG at 9pm** · 2/10 · lvl 60");
    expect(en).toContain("In: Aria, Brom");
    expect(en).toContain("Waiting: Cleo");
    expect(en).toContain("[Join on the post](https://discord.com/channels/1/2/3)");
    const fr = pvpGroupLine(view({ started: true }), "fr");
    expect(fr).toContain("niv. 60");
    expect(fr).toContain("démarré");
    expect(fr).toContain("Rejoindre sur le message");
  });
  it("shows a friendly empty state, French too, and counts open groups and players", () => {
    expect(lookingEmbed([], "en").toJSON().description).toContain("Nobody is looking");
    expect(lookingEmbed([], "fr").toJSON().description).toContain("Personne ne cherche");
    const json = lookingEmbed([view(), view({ id: "g2", members: ["Brom", "Dax"] })], "en").toJSON();
    expect(json.footer?.text).toContain("2 open group(s) · 3 player(s)");
    expect(json.footer?.text).toContain("expire after 24 h");
  });
  it("loads only open or started PvP groups, narrowed to a member's own for My groups", async () => {
    const findMany = vi.fn(async () => [{ id: "g1", title: "WSG", maxSize: 10, createdAt: new Date(), status: "OPEN", minLevel: null, maxLevel: null, signupChannelId: "c", signupMessageId: "m",
      signups: [{ status: "SIGNED_UP", member: { displayName: "Aria" } }, { status: "WAITLISTED", member: { displayName: "Brom" } }] }]);
    const groups = await loadPvpGroups({ dungeonGroup: { findMany } } as never, "scope", "disc", "m1");
    expect(groups[0]).toMatchObject({ members: ["Aria"], waiting: ["Brom"], link: "https://discord.com/channels/disc/c/m" });
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ guildId: "scope", kind: { in: ["PVP", "WORLDPVP"] }, status: { in: ["OPEN", "STARTED"] } });
    expect(where["OR"]).toBeTruthy();
    await loadPvpGroups({ dungeonGroup: { findMany } } as never, "scope", "disc");
    expect((findMany.mock.calls[1] as unknown as [{ where: Record<string, unknown> }])[0].where["OR"]).toBeUndefined();
  });
});

describe("finder behaviour shared with the dungeon finder", () => {
  it("a PvP group takes any role up to its size and queues the overflow", async () => {
    const tx = { dungeonGroup: { findFirst: vi.fn(async () => ({ id: "g", kind: "PVP", status: "OPEN", maxSize: 2 })) },
      dungeonGroupSignup: { count: vi.fn(async () => 2), findUnique: vi.fn(async () => null), upsert: vi.fn(async ({ create }: { create: { status: string } }) => create) }, $executeRaw: vi.fn() };
    const db = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const result = await createDungeonGroupService(db as never).join("g", "guild", "member", "HEALER");
    expect(result.signup.status).toBe("WAITLISTED");
    expect((tx.dungeonGroupSignup.count.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where).not.toHaveProperty("role");
  });
  it("creates kind PVP groups with the asked size", async () => {
    const create = vi.fn(async ({ data }: { data: unknown }) => data);
    const row = await createDungeonGroupService({ dungeonGroup: { create } } as never).create({ guildId: "g", title: "AB tonight", leaderId: "m", channelId: "c", kind: "PVP", size: 15 }) as unknown as { kind: string; maxSize: number };
    expect(row).toMatchObject({ kind: "PVP", maxSize: 15 });
  });
});

describe("the pvp-groups panel", () => {
  it("offers Create, Who's looking, My groups and Upcoming in both languages", () => {
    for (const [lang, labels] of [["en", ["Create", "Who's looking", "My groups", "Upcoming"]], ["fr", ["Créer", "Qui cherche", "Mes groupes", "À venir"]]] as const) {
      const panel = bgSetupPanel("groups", "scope", lang);
      expect(panel.components[0]!.components.map(b => b.toJSON())).toMatchObject(labels.map(label => ({ label })));
      expect(panel.components[0]!.components.map(b => (b.toJSON() as { custom_id: string }).custom_id)).toEqual(["create", "looking", "mine", "upcoming"].map(a => `bgui:scope:${a}`));
    }
  });
});
