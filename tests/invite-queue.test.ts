import { describe, expect, it } from "vitest";
import { inviteListForAddon, markInvitedByMessage, markInvitedByName, nameKeyOf, parseInviteName, pendingInvites, recordInviteRequest } from "../src/services/invite-queue.js";
import { channelNames, channelSpec } from "../src/setup-names.js";
import { standingsToLua } from "../companion/standings-format.mjs";

interface Row { id: string; guildId: string; nameKey: string; displayName: string; discordUserId: string; channelId: string; messageId: string; status: string; invitedBy: string | null; createdAt: Date; invitedAt: Date | null }
function fakeDatabase() {
  const rows: Row[] = [];
  let n = 0;
  const matches = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) =>
    value && typeof value === "object" && "in" in (value as object) ? ((value as { in: unknown[] }).in).includes((row as never)[key]) : (row as never)[key] === value);
  return {
    rows,
    inviteRequest: {
      upsert: async ({ where, create, update }: { where: { guildId_messageId: { guildId: string; messageId: string } }; create: Partial<Row>; update: Partial<Row> }) => {
        const found = rows.find((row) => row.guildId === where.guildId_messageId.guildId && row.messageId === where.guildId_messageId.messageId);
        if (found) return Object.assign(found, update);
        const row = { id: `r${++n}`, status: "PENDING", invitedBy: null, invitedAt: null, createdAt: new Date(2026, 10, 6, 12, n), ...create } as Row;
        rows.push(row); return row;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where)),
      findUnique: async ({ where }: { where: { guildId_messageId: { guildId: string; messageId: string } } }) => rows.find((row) => row.guildId === where.guildId_messageId.guildId && row.messageId === where.guildId_messageId.messageId) ?? null,
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<Row> }) => { for (const row of rows) if (where.id.in.includes(row.id)) Object.assign(row, data); return { count: where.id.in.length }; }
    }
  };
}

describe("parseInviteName", () => {
  it.each([
    ["Lebowski Holyroller", "Lebowski Holyroller"],
    ["  lebowski   holyroller ", "lebowski holyroller"],
    ["Nom: Lebowski Holyroller", "Lebowski Holyroller"],
    ["perso - Lebowski Holyroller (paladin)", "Lebowski Holyroller"],
    ["/ginvite Lebowski Holyroller", "Lebowski Holyroller"],
    ["**Lebowski Holyroller**", "Lebowski Holyroller"],
    ["Lebowski Holyroller.", "Lebowski Holyroller"],
    ["Éloïse D'Artagnan", "Éloïse D'Artagnan"],
    ["Jean-Luc Picard", "Jean-Luc Picard"],
    ["Lebowski Holyroller\nthanks!", "Lebowski Holyroller"]
  ])("reads %j", (text, expected) => expect(parseInviteName(text)?.displayName).toBe(expected));
  it.each(["", "   ", "Lebowski", "hello can I join the guild please", "Lebowski-Realm", "12 34", "<@123456789012345678>", "https://example.com/a b", "a b"])("rejects %j", (text) => {
    expect(parseInviteName(text)).toBeNull();
  });
  it("keys names lowercase so the roster matches whatever case was typed", () => {
    expect(parseInviteName("Lebowski HOLYROLLER")?.nameKey).toBe("lebowski holyroller");
    expect(nameKeyOf("  Lebowski   Holyroller ")).toBe("lebowski holyroller");
  });
});

describe("the invite queue", () => {
  const post = (database: ReturnType<typeof fakeDatabase>, name: string, messageId: string, guildId = "g1") =>
    recordInviteRequest(database as never, { guildId, parsed: parseInviteName(name)!, discordUserId: `u-${messageId}`, channelId: "c1", messageId });

  it("records once per message and lists each waiting name once, oldest first", async () => {
    const database = fakeDatabase();
    await post(database, "Amy Archer", "m1"); await post(database, "Bob Brewer", "m2"); await post(database, "amy archer", "m3");
    await post(database, "Amy Archer", "m1");
    expect(database.rows).toHaveLength(3);
    expect((await pendingInvites(database as never, "g1")).map((row) => row.displayName)).toEqual(["Amy Archer", "Bob Brewer"]);
    expect(await pendingInvites(database as never, "other")).toEqual([]);
  });

  it("a roster upload completes every waiting post of that name, and only that guild's", async () => {
    const database = fakeDatabase();
    await post(database, "Amy Archer", "m1"); await post(database, "Amy Archer", "m2"); await post(database, "Bob Brewer", "m3"); await post(database, "Amy Archer", "m4", "g2");
    const done = await markInvitedByName(database as never, "g1", ["AMY ARCHER", "Nobody Here"], "roster");
    expect(done.map((row) => row.messageId).sort()).toEqual(["m1", "m2"]);
    expect(database.rows.filter((row) => row.status === "INVITED").map((row) => row.messageId).sort()).toEqual(["m1", "m2"]);
    expect(database.rows.find((row) => row.messageId === "m1")).toMatchObject({ invitedBy: "roster" });
    expect((await pendingInvites(database as never, "g1")).map((row) => row.displayName)).toEqual(["Bob Brewer"]);
    expect(await markInvitedByName(database as never, "g1", [], "roster")).toEqual([]);
  });

  it("an officer's check mark finishes that name; a repeat or unknown post does nothing", async () => {
    const database = fakeDatabase();
    await post(database, "Amy Archer", "m1"); await post(database, "Amy Archer", "m2");
    expect(await markInvitedByMessage(database as never, "g1", "m2", "officer-1")).toHaveLength(2);
    expect(await markInvitedByMessage(database as never, "g1", "m2", "officer-1")).toEqual([]);
    expect(await markInvitedByMessage(database as never, "g1", "nope", "officer-1")).toEqual([]);
  });

  it("gives the addon names only, never Discord IDs", () => {
    const list = inviteListForAddon([{ displayName: "Amy Archer", createdAt: new Date("2026-11-06T12:00:00Z") }]);
    expect(list).toEqual([{ name: "Amy Archer", at: "2026-11-06T12:00:00.000Z" }]);
  });
});

describe("the guild-invite channel in /setup", () => {
  it("is guild-invites in English and invitation-guilde in French, open to everyone, with a topic that explains it", () => {
    expect(channelSpec("inviteChannelId", "en")).toMatchObject({ name: "guild-invites", access: "open", category: "guild" });
    expect(channelSpec("inviteChannelId", "fr")).toMatchObject({ name: "invitation-guilde", access: "open" });
    expect(channelSpec("inviteChannelId", "en").topic).toContain("Lebowski Holyroller");
    expect(channelSpec("inviteChannelId", "fr").topic).toContain("nom complet");
    expect(channelNames("inviteChannelId")).toEqual(["guild-invites", "invitation-guilde"]);
  });
});

describe("what the companion writes for officers", () => {
  const base = { updatedAt: "2026-11-06T12:00:00Z", baseGp: 0, standings: [] };
  it("adds GuildedInvites only when the bot sent the list", () => {
    const lua = standingsToLua({ ...base, officerInvites: [{ name: 'Amy "Archer"', at: "2026-11-06T11:00:00Z" }] } as never);
    expect(lua).toContain("GuildedInvites = { fetchedAt =");
    expect(lua).toContain('{ name = "Amy \\"Archer\\"", at = "2026-11-06T11:00:00Z" },');
    expect(standingsToLua(base as never)).toContain("GuildedInvites = nil");
  });
});
