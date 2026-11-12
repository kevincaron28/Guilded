import { afterEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/services/housekeeping.js", () => ({ postToLogChannel: log }));
import {
  handleLinkedButton, linkedCharactersAnswer, linkedCharactersRow, linkedLines, linkedMessage, linkUndoRows, scheduleLinkedCharacters, tellAutoLinked, tellLinkedCharacters
} from "../src/services/companion-link-dm.js";

// Owner decisions (8.5 track F3, ROADMAP 5): one DM listing the linked characters on the first link and whenever new
// ones are linked (once per change, batched), a "My linked characters" button that works in DMs, closed DMs skipped.
type Row = { id: string; name: string; displayName: string | null; className: string; level: number | null; isMain: boolean };
const aran: Row = { id: "c1", name: "Aran", displayName: "Aran Dawnfield", className: "Warrior", level: 60, isMain: true };
const bel: Row = { id: "c2", name: "Bel", displayName: null, className: "Mage", level: null, isMain: false };
const cyr: Row = { id: "c3", name: "Cyr", displayName: "Cyr Stonehand", className: "Priest", level: 12, isMain: false };

function fakes(initial: Row[], send = vi.fn(async () => undefined)) {
  let rows = initial;
  let notice: { characterIds: string } | null = null;
  const database = {
    character: { findMany: vi.fn(async () => rows.map((row) => ({ ...row, member: { guildId: "g1", discordUserId: "111" } }))), count: vi.fn(async () => rows.length) },
    member: { findMany: vi.fn(async () => [{ guildId: "g1", guild: { name: "Quebec Gold" }, characters: rows }]) },
    memberLinkNotice: {
      findUnique: vi.fn(async () => notice),
      upsert: vi.fn(async ({ create, update }: { create: { characterIds: string }; update: { characterIds: string } }) => { notice = notice ? update : create; return notice; })
    },
    guildSettings: { findUnique: vi.fn(async () => ({ language: "en" })) }
  };
  const client = { users: { send }, guilds: { fetch: vi.fn(async () => ({ name: "Quebec Gold" })) } };
  return { database, client, send, setRows: (next: Row[]) => { rows = next; } };
}
const run = (f: ReturnType<typeof fakes>, before: number, lang: "en" | "fr" = "en") =>
  tellLinkedCharacters(f.client as never, f.database as never, { guildDiscordId: "999", memberId: "m1", lang, before });
const sent = (f: ReturnType<typeof fakes>, call = 0) => f.send.mock.calls[call] as unknown as [string, { content: string; components: unknown[]; allowedMentions: unknown }];

afterEach(() => { vi.useRealTimers(); });

describe("linked characters DM", () => {
  it("lists every character by full name with class, level and the main, on the first link", async () => {
    const f = fakes([aran, bel]);
    expect(await run(f, 0)).toBe(true);
    const [user, message] = sent(f);
    expect(user).toBe("111");
    expect(message.content).toContain("You're linked on **Quebec Gold**");
    expect(message.content).toContain("⭐ **Aran Dawnfield** — Warrior level 60 (main)");
    expect(message.content).toContain("• **Bel** — Mage");
    expect(message.content).toContain("`/character unlink`");
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(message.components).toHaveLength(2); // Not mine buttons, then My linked characters + Wrong server
    const ids = JSON.stringify(message.components);
    expect(ids).toContain("linked:no:c1");
    expect(ids).toContain("linked:no:c2");
    expect(ids).toContain("linked:server");
  });

  it("sends once per change: a repeat upload says nothing, new characters get one batched DM, unlinks stay silent", async () => {
    const f = fakes([aran]);
    expect(await run(f, 0)).toBe(true);
    expect(await run(f, 1)).toBe(false); // same set again
    f.setRows([aran, bel, cyr]); // one sync adds two characters
    expect(await run(f, 1)).toBe(true);
    expect(f.send).toHaveBeenCalledTimes(2);
    const added = sent(f, 1)[1].content;
    expect(added).toContain("**Bel**, **Cyr Stonehand**");
    expect(added).toContain("⭐ **Aran Dawnfield**"); // the full list comes too
    expect(await run(f, 3)).toBe(false);
    f.setRows([aran, cyr]); // an unlink is not news
    expect(await run(f, 3)).toBe(false);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it("only records members who were linked before this feature, and says nothing when nothing is linked", async () => {
    const old = fakes([aran]);
    expect(await run(old, 1)).toBe(false);
    expect(old.send).not.toHaveBeenCalled();
    old.setRows([aran, bel]);
    expect(await run(old, 1)).toBe(true); // a later addition is announced
    const none = fakes([]);
    expect(await run(none, 0)).toBe(false);
    expect(none.send).not.toHaveBeenCalled();
  });

  it("never throws and never repeats when DMs are closed", async () => {
    const f = fakes([aran], vi.fn(async () => { throw new Error("Cannot send messages to this user"); }));
    await expect(run(f, 0)).resolves.toBe(false);
    expect(await run(f, 1)).toBe(false);
    expect(f.send).toHaveBeenCalledTimes(1); // marked before sending: no retry storm
  });

  it("merges uploads inside the window into one DM", async () => {
    vi.useFakeTimers();
    const f = fakes([aran, bel]);
    const input = { guildDiscordId: "999", memberId: "m1", lang: "en" as const, before: 0 };
    scheduleLinkedCharacters(f.client as never, f.database as never, input, 1000);
    f.setRows([aran, bel, cyr]);
    await vi.advanceTimersByTimeAsync(500);
    scheduleLinkedCharacters(f.client as never, f.database as never, { ...input, before: 2 }, 1000);
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(sent(f)[1].content).toContain("Cyr Stonehand");
    expect(sent(f)[1].content).toContain("You're linked on"); // `before` of the first call still counts as the first link
  });

  it("escapes names, caps the list and speaks French", () => {
    expect(linkedLines("en", [{ ...bel, name: "Bad*Name" }], null)).toContain("**Bad\\*Name**");
    const many = Array.from({ length: 30 }, (_, index) => ({ ...bel, name: `N${index}` }));
    expect(linkedLines("en", many, null)).toContain("and 5 more");
    const fr = linkedLines("fr", [aran], null);
    expect(fr).toContain("Guerrier niveau 60 (principal)");
    expect(linkedMessage("fr", "Guilde", fr, [])).toContain("Tu es lié sur **Guilde**");
    expect(linkedMessage("fr", "Guilde", fr, ["Bel"])).toContain("Nouveau sur **Guilde**");
    expect(JSON.stringify(linkedCharactersRow("fr").toJSON())).toContain("Mes personnages");
  });
});

describe("My linked characters button", () => {
  it("answers privately in a DM, resolving the member from the Discord user across guilds", async () => {
    const f = fakes([aran, bel]);
    const reply = vi.fn(async () => undefined);
    const interaction = { customId: "linked:mine", user: { id: "111" }, guildId: null, deferReply: vi.fn(async () => undefined), editReply: reply };
    await handleLinkedButton(interaction as never, f.database as never);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    const content = (reply.mock.calls[0] as unknown as [{ content: string }])[0].content;
    expect(content).toContain("**Quebec Gold**");
    expect(content).toContain("⭐ **Aran Dawnfield**");
    expect(content).toContain("`/character unlink`");
    expect(f.database.member.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ discordUserId: "111" }) }));
    const where = (f.database.member.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).not.toHaveProperty("guild"); // no guild context in a DM
  });

  it("limits to the server when clicked in one, and answers in both languages when nothing is linked", async () => {
    const f = fakes([aran]);
    await linkedCharactersAnswer(f.database as never, "111", "999");
    expect((f.database.member.findMany.mock.calls[0] as unknown as [{ where: { guild: unknown } }])[0].where.guild).toEqual({ discordId: "999" });
    f.database.member.findMany.mockResolvedValueOnce([]);
    const none = await linkedCharactersAnswer(f.database as never, "222");
    expect(none).toContain("no linked characters");
    expect(none).toContain("pas encore de personnage");
  });
});

describe("undo for every automatic link", () => {
  it("uses one Not mine button per character up to five, a select menu above, and always two rows at most", () => {
    const few = linkUndoRows("en", [aran, bel, cyr], null).map((row) => row.toJSON());
    expect(few).toHaveLength(2);
    expect(few[0]!.components.map((component) => (component as { label: string }).label)).toEqual(["Not mine: Aran Dawnfield", "Not mine: Bel", "Not mine: Cyr Stonehand"]);
    const many = Array.from({ length: 30 }, (_, index) => ({ id: `x${index}`, name: `N${index}`, displayName: null }));
    const menu = linkUndoRows("fr", many, null).map((row) => row.toJSON());
    expect(menu).toHaveLength(2);
    const select = menu[0]!.components[0] as { custom_id: string; options: unknown[]; placeholder: string };
    expect(select.custom_id).toBe("linked:no");
    expect(select.options).toHaveLength(25);
    expect(JSON.stringify(menu[1])).toContain("Mauvais serveur");
  });

  function undoFakes(ownerId = "111") {
    const character = { id: "c1", name: "Aran", realm: "Forever", gameEdition: "forever", displayName: "Aran Dawnfield", member: { id: "m1", guildId: "g1", discordUserId: ownerId, guild: { discordId: "999", name: "Quebec Gold" } } };
    const tx = { character: { findUnique: vi.fn(async () => ({ ...character, memberId: "m1", detachedAt: null, isMain: false })), update: vi.fn(async () => undefined), findFirst: vi.fn(async () => null) }, member: { upsert: vi.fn(async () => ({ id: "holding" })) }, characterLinkConflict: { updateMany: vi.fn(async () => undefined) } };
    const database = {
      character: { findUnique: vi.fn(async () => character), delete: vi.fn(async () => undefined), findMany: vi.fn(async () => []) },
      member: { findMany: vi.fn(async () => []) },
      guildSettings: { findUnique: vi.fn(async () => ({ language: "en" })) },
      characterVerifyClaim: { upsert: vi.fn(async () => undefined) }, $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx))
    };
    const guild = { id: "999" };
    const interaction = { customId: "linked:no:c1", user: { id: "111" }, client: { guilds: { fetch: vi.fn(async () => guild) } }, isStringSelectMenu: () => false, deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined), reply: vi.fn(async () => undefined) };
    return { database, interaction, guild, tx };
  }

  it("Not mine unlinks the character as BLOCKED (not REMOVED) and writes one officer log line", async () => {
    log.mockClear();
    const f = undoFakes();
    await handleLinkedButton(f.interaction as never, f.database as never);
    expect(f.database.character.delete).not.toHaveBeenCalled(); // detached with its history, like /character unlink
    expect(f.tx.character.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" }, data: expect.objectContaining({ detachedFromMemberId: "m1" }) }));
    expect(f.database.characterVerifyClaim.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: "BLOCKED", memberId: "m1", guildId: "g1" }) }));
    expect(log).toHaveBeenCalledTimes(1);
    expect((log.mock.calls[0] as unknown as [unknown, string])[1]).toContain("<@111> unlinked Aran Dawnfield");
    expect((f.interaction.editReply.mock.calls[0] as unknown as [{ content: string }])[0].content).toContain("unlinked from you");
  });

  it("the select menu path unlinks the chosen character, and only the DM's member can press it", async () => {
    log.mockClear();
    const menu = undoFakes();
    await handleLinkedButton({ ...menu.interaction, customId: "linked:no", isStringSelectMenu: () => true, values: ["c1"] } as never, menu.database as never);
    expect(menu.tx.character.update).toHaveBeenCalledTimes(1);
    const other = undoFakes("999999");
    await handleLinkedButton(other.interaction as never, other.database as never);
    expect(other.tx.character.update).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const gone = undoFakes();
    gone.database.character.findUnique.mockResolvedValueOnce(null as never);
    await handleLinkedButton(gone.interaction as never, gone.database as never);
    expect((gone.interaction.editReply.mock.calls[0] as unknown as [{ content: string }])[0].content).toContain("already unlinked");
  });

  it("Wrong server explains Remove this server in the companion, in both languages", async () => {
    const f = undoFakes();
    await handleLinkedButton({ ...f.interaction, customId: "linked:server" } as never, f.database as never);
    const content = (f.interaction.reply.mock.calls[0] as unknown as [{ content: string }])[0].content;
    expect(content).toContain("Remove this server");
    expect(content).toContain("compagnon Guilded");
    expect(f.tx.character.update).not.toHaveBeenCalled();
  });

  it("name-match, sole-newcomer and claim links send the same DM (one per member), and a closed DM is skipped quietly", async () => {
    vi.useFakeTimers();
    const f = fakes([aran, bel]);
    await tellAutoLinked(f.client as never, f.database as never, "999", "g1", [{ memberId: "m1", count: 2 }], 100);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sent(f)[1].components)).toContain("linked:no:c1");
    const closed = fakes([aran], vi.fn(async () => { throw new Error("Cannot send messages to this user"); }));
    await tellAutoLinked(closed.client as never, closed.database as never, "999", "g1", [{ memberId: "m2", count: 1 }], 100);
    await expect(vi.advanceTimersByTimeAsync(200)).resolves.not.toThrow();
  });
});
