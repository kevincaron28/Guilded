import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/hosted-pilot.js", () => ({ hostedPilot: { allows: (id: string) => id !== "blocked" } }));
const claimCharacter = vi.fn();
vi.mock("../src/services/character-autolink.js", () => ({ claimCharacter: (...args: unknown[]) => claimCharacter(...args) }));

import { answerCharacterDm, handleCharacterDm, resetDmLinkRateLimit } from "../src/services/dm-character-link.js";
import { parseInviteName } from "../src/services/invite-queue.js";

interface World {
  members?: { id: string; guildId: string; discordId: string; lang?: string; name?: string }[];
  characters?: { id: string; name: string; displayName?: string | null; memberId: string; guildId: string }[];
  unclaimed?: { id: string; name: string; displayName?: string | null; guildId: string }[];
}
function db(world: World) {
  return {
    member: { findMany: vi.fn(async () => (world.members ?? []).map((m) => ({ id: m.id, guildId: m.guildId, guild: { discordId: m.discordId, name: m.name ?? `Server ${m.guildId}`, settings: { language: m.lang ?? "en" } } }))) },
    character: {
      findMany: vi.fn(async ({ where }: { where: { guildId?: string; member?: unknown } }) => (world.characters ?? []).filter((c) => !where.guildId || c.guildId === where.guildId)),
      findFirst: vi.fn(async ({ where }: { where: { memberId: string; name: string } }) => (world.characters ?? []).find((c) => c.memberId === where.memberId && c.name === where.name) ?? null)
    },
    unclaimedCharacter: { findMany: vi.fn(async ({ where }: { where: { guildId: string } }) => (world.unclaimed ?? []).filter((u) => u.guildId === where.guildId)) },
    guildRosterEntry: { findMany: vi.fn(async () => []) }, publicRunPlayer: { findMany: vi.fn(async () => []) }
  };
}
const message = (content: string, overrides: Record<string, unknown> = {}) => {
  const reply = vi.fn(async () => undefined);
  return { message: { guildId: null, author: { id: "u1", bot: false }, content, reply, ...overrides } as never, reply };
};
const parsed = (name: string) => parseInviteName(name)!;
const member = { id: "m1", guildId: "g1", discordId: "d1" };

beforeEach(() => { claimCharacter.mockReset(); resetDmLinkRateLimit(); });

describe("DM a character name to link it", () => {
  it("links the one unclaimed match with the typed (named) claim and offers the undo button", async () => {
    const world = { members: [member], unclaimed: [{ id: "un1", name: "Lebowski Holyroller", guildId: "g1" }], characters: [] as never[] };
    const database = db(world);
    claimCharacter.mockImplementation(async () => { world.characters.push({ id: "c1", name: "Lebowski Holyroller", memberId: "m1", guildId: "g1" } as never); return { row: { name: "Lebowski Holyroller" }, isMain: true }; });
    const { message: dm, reply } = message("lebowski HOLYROLLER");
    expect(await handleCharacterDm(dm, database as never)).toBe(true);
    expect(claimCharacter).toHaveBeenCalledWith(database, "g1", "m1", "un1");
    const sent = (reply.mock.calls[0] as unknown as [{ content: string; components: { toJSON(): { components: { custom_id: string }[] } }[]; allowedMentions: unknown }])[0];
    expect(sent.content).toContain("Linked **Lebowski Holyroller**");
    expect(sent.content).toContain("Server g1");
    expect(JSON.stringify(sent.components.map((row) => row.toJSON()))).toContain("linked:no:c1");
    expect(sent.allowedMentions).toEqual({ parse: [] });
  });
  it("prefers the full-name row over an old first-name-only row with the same display name", async () => {
    const database = db({ members: [member], unclaimed: [
      { id: "old", name: "Chad", displayName: "Chad Ho", guildId: "g1" },
      { id: "full", name: "Chad Ho", displayName: "Chad Ho", guildId: "g1" }] });
    claimCharacter.mockResolvedValue({ row: { name: "Chad Ho" }, isMain: true });
    const answer = await answerCharacterDm(database as never, "u1", parsed("Chad Ho"));
    expect(claimCharacter).toHaveBeenCalledWith(database, "g1", "m1", "full");
    expect(answer?.content).toContain("Linked");
  });
  it("still refuses two different full-name rows that read the same", async () => {
    const database = db({ members: [member], unclaimed: [
      { id: "a", name: "Chad Ho", guildId: "g1" }, { id: "b", name: "Chad Hô", guildId: "g1" }] });
    const answer = await answerCharacterDm(database as never, "u1", parsed("Chad Ho"));
    expect(claimCharacter).not.toHaveBeenCalled();
    expect(answer?.content).toContain("don't know");
  });
  it("matches accents and case", async () => {
    const database = db({ members: [member], unclaimed: [{ id: "un1", name: "Élodie Brûlé", guildId: "g1" }] });
    claimCharacter.mockResolvedValue({ row: { name: "Élodie Brûlé" }, isMain: false });
    const answer = await answerCharacterDm(database as never, "u1", parsed("elodie brule"));
    expect(claimCharacter).toHaveBeenCalledTimes(1);
    expect(answer?.content).toContain("Linked");
  });
  it("says so when the character is already the member's", async () => {
    const database = db({ members: [member], characters: [{ id: "c1", name: "Lebowski Holyroller", memberId: "m1", guildId: "g1" }] });
    const answer = await answerCharacterDm(database as never, "u1", parsed("Lebowski Holyroller"));
    expect(answer?.content).toContain("already linked to you");
    expect(claimCharacter).not.toHaveBeenCalled();
  });
  it("never moves another member's character and names nobody", async () => {
    const database = db({ members: [member], characters: [{ id: "c1", name: "Lebowski Holyroller", memberId: "someone-else", guildId: "g1" }] });
    const answer = await answerCharacterDm(database as never, "u1", parsed("Lebowski Holyroller"));
    expect(claimCharacter).not.toHaveBeenCalled();
    expect(answer?.content).toContain("linked to another member");
    expect(answer?.content).toContain("companion");
    expect(answer?.content).not.toContain("someone-else");
  });
  it("answers kindly when nothing matches", async () => {
    claimCharacter.mockRejectedValue(new Error("No unclaimed character"));
    const answer = await answerCharacterDm(db({ members: [member] }) as never, "u1", parsed("Nobody Known"));
    expect(answer?.content).toContain("I don't know **Nobody Known**");
    expect(answer?.content).toContain("first AND last");
  });
  it("links in every server where it is unambiguous and says which", async () => {
    const database = db({
      members: [member, { id: "m2", guildId: "g2", discordId: "d2", name: "Second" }, { id: "m3", guildId: "g3", discordId: "d3", name: "Third" }],
      unclaimed: [{ id: "u-a", name: "Lebowski Holyroller", guildId: "g1" }, { id: "u-b", name: "Lebowski Holyroller", guildId: "g2" }, { id: "u-c1", name: "Lebowski Holyroller", guildId: "g3" }, { id: "u-c2", name: "Lebowski Holyroller", guildId: "g3" }]
    });
    claimCharacter.mockImplementation(async (_db: unknown, _g: string, _m: string, id: string) => ({ row: { name: `Lebowski Holyroller ${id}` }, isMain: false }));
    const answer = await answerCharacterDm(database as never, "u1", parsed("Lebowski Holyroller"));
    expect(claimCharacter).toHaveBeenCalledTimes(2);
    expect(answer?.content).toContain("Server g1");
    expect(answer?.content).toContain("Second");
    expect(answer?.content).not.toContain("Third");
  });
  it("replies in the server's language (French)", async () => {
    const database = db({ members: [{ ...member, lang: "fr" }], characters: [{ id: "c1", name: "Lebowski Holyroller", memberId: "m1", guildId: "g1" }] });
    const answer = await answerCharacterDm(database as never, "u1", parsed("Lebowski Holyroller"));
    expect(answer?.content).toContain("déjà lié à toi");
  });
  it("ignores a DM that is not a name, a bot, a server message and a user in no approved server", async () => {
    const database = db({ members: [member] });
    expect(await handleCharacterDm(message("hello there friend").message, database as never)).toBe(false);
    expect(await handleCharacterDm(message("Lebowski Holyroller", { author: { id: "b", bot: true } }).message, database as never)).toBe(false);
    expect(await handleCharacterDm(message("Lebowski Holyroller", { guildId: "g" }).message, database as never)).toBe(false);
    const none = message("Lebowski Holyroller");
    expect(await handleCharacterDm(none.message, db({ members: [{ ...member, discordId: "blocked" }] }) as never)).toBe(true);
    expect(none.reply).not.toHaveBeenCalled();
  });
  it("replies at most once per 10 seconds per user", async () => {
    const database = db({ members: [member], characters: [{ id: "c1", name: "Lebowski Holyroller", memberId: "m1", guildId: "g1" }] });
    const first = message("Lebowski Holyroller"); const second = message("Lebowski Holyroller");
    await handleCharacterDm(first.message, database as never, { now: 1_000_000 });
    await handleCharacterDm(second.message, database as never, { now: 1_005_000 });
    expect(first.reply).toHaveBeenCalledTimes(1);
    expect(second.reply).not.toHaveBeenCalled();
    const third = message("Lebowski Holyroller");
    await handleCharacterDm(third.message, database as never, { now: 1_011_000 });
    expect(third.reply).toHaveBeenCalledTimes(1);
  });
  it("after an invite request, links nothing and only offers a known character", async () => {
    const database = db({ members: [member], unclaimed: [{ id: "un1", name: "Lebowski Holyroller", guildId: "g1" }] });
    const dm = message("Lebowski Holyroller");
    await handleCharacterDm(dm.message, database as never, { afterInvite: true });
    expect(claimCharacter).not.toHaveBeenCalled();
    expect(dm.reply).toHaveBeenCalledTimes(1);
    expect((dm.reply.mock.calls[0] as unknown as [{ content: string }])[0].content).toContain("guild-invite channel");
    const quiet = message("Nobody Known");
    await handleCharacterDm(quiet.message, database as never, { afterInvite: true });
    expect(quiet.reply).not.toHaveBeenCalled();
  });
});
