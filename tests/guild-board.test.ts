import { describe, expect, it } from "vitest";
import {
  applyBoardVotes, applyRelayedBoardVotes, boardForAddon, boardText, createBoardService, myBoardVotes, parseAddonBoardPosts, parseAddonBoardVotes, setBoardPicks
} from "../src/services/guild-board.js";
import { exportGuildBoard } from "../companion/lua-export-content.mjs";
import { guildBoardToLua } from "../companion/standings-format.mjs";

// 9.1 in-game guild board (docs/GUILD_BOARD.md): news and open polls in the feed, votes from the game.
type Poll = { id: string; guildId: string; question: string; options: string[]; maxChoices: number; closed: boolean; closesAt: Date | null; createdAt: Date };
type Vote = { pollId: string; memberId: string; option: number; votedAt: Date };
type Post = { id: string; guildId: string; body: string; author: string; authorId: string | null; memberId: string | null; source: string; clientRef: string | null;
  channelId: string | null; messageId: string | null; removedAt: Date | null; createdAt: Date };

const NOW = Math.floor(Date.now() / 1000);

function fakeDb(input: { polls?: Poll[]; votes?: Vote[]; posts?: Post[]; boardOn?: boolean; characters?: { name: string; displayName: string | null; memberId: string }[] } = {}) {
  const polls = input.polls ?? [], votes = input.votes ?? [], posts = input.posts ?? [];
  const open = (p: Poll) => !p.closed && !(p.closesAt && p.closesAt.getTime() <= Date.now());
  let next = 1;
  return {
    votes, posts,
    guildSettings: { findUnique: async () => ({ guildBoardEnabled: input.boardOn ?? true }) },
    character: { findMany: async () => input.characters ?? [] },
    poll: {
      findMany: async ({ where, take }: { where: { guildId: string }; take: number }) => polls.filter((p) => p.guildId === where.guildId && open(p))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
      findFirst: async ({ where }: { where: { id: string; guildId: string } }) => polls.find((p) => p.id === where.id && p.guildId === where.guildId) ?? null
    },
    pollVote: {
      findMany: async ({ where }: { where: { pollId?: string | { in: string[] }; memberId?: string; poll?: { guildId: string } } }) => votes.filter((v) => {
        if (typeof where.pollId === "string" && v.pollId !== where.pollId) return false;
        if (where.pollId && typeof where.pollId === "object" && !where.pollId.in.includes(v.pollId)) return false;
        if (where.memberId && v.memberId !== where.memberId) return false;
        if (where.poll) { const p = polls.find((x) => x.id === v.pollId); if (!p || p.guildId !== where.poll.guildId || !open(p)) return false; }
        return true;
      }),
      deleteMany: async ({ where }: { where: { pollId: string; memberId: string; option: { notIn: number[] } } }) => {
        for (let i = votes.length - 1; i >= 0; i--) {
          const v = votes[i]!;
          if (v.pollId === where.pollId && v.memberId === where.memberId && !where.option.notIn.includes(v.option)) votes.splice(i, 1);
        }
      },
      upsert: async ({ create }: { create: Vote }) => { votes.push(create); return create; }
    },
    boardPost: {
      findMany: async ({ where, take }: { where: { guildId: string; createdAt?: { gte: Date } }; take: number }) => posts
        .filter((p) => p.guildId === where.guildId && !p.removedAt && (!where.createdAt || p.createdAt >= where.createdAt.gte))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
      findUnique: async ({ where }: { where: { guildId_clientRef: { guildId: string; clientRef: string } } }) =>
        posts.find((p) => p.guildId === where.guildId_clientRef.guildId && p.clientRef === where.guildId_clientRef.clientRef) ?? null,
      findFirst: async ({ where }: { where: { id: string; guildId: string } }) => posts.find((p) => p.id === where.id && p.guildId === where.guildId && !p.removedAt) ?? null,
      create: async ({ data }: { data: Omit<Post, "id" | "createdAt" | "removedAt" | "channelId" | "messageId"> }) => {
        const post: Post = { id: `post${next++}`, createdAt: new Date(), removedAt: null, channelId: null, messageId: null, ...data };
        posts.push(post);
        return post;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Post> }) => Object.assign(posts.find((p) => p.id === where.id)!, data)
    }
  };
}

const poll = (over: Partial<Poll> = {}): Poll => ({ id: "pollaaa1", guildId: "g1", question: "Raid night?", options: ["Friday", "Saturday", "Sunday"], maxChoices: 1,
  closed: false, closesAt: null, createdAt: new Date(Date.now() - 60_000), ...over });

describe("the board in the standings feed", () => {
  it("lists recent news and open polls with counts, and nothing but enabled:false when officers turned it off", async () => {
    const db = fakeDb({
      polls: [poll(), poll({ id: "pollclosed", closed: true }), poll({ id: "pollexpired", closesAt: new Date(Date.now() - 1000) })],
      votes: [{ pollId: "pollaaa1", memberId: "m1", option: 1, votedAt: new Date() }, { pollId: "pollaaa1", memberId: "m2", option: 1, votedAt: new Date() }],
      posts: [{ id: "n1", guildId: "g1", body: "Bring |cffff0000 flasks\nplease", author: "Ann", authorId: "1", memberId: null, source: "discord", clientRef: null, channelId: null, messageId: null, removedAt: null, createdAt: new Date() },
        { id: "n0", guildId: "g1", body: "Taken down", author: "Ann", authorId: "1", memberId: null, source: "discord", clientRef: null, channelId: null, messageId: null, removedAt: new Date(), createdAt: new Date() }]
    });
    const board = await boardForAddon(db as never, "g1");
    expect(board.enabled).toBe(true);
    expect(board.news).toEqual([expect.objectContaining({ id: "n1", by: "Ann", text: "Bring cffff0000 flasks please" })]);
    expect(board.polls).toEqual([expect.objectContaining({ id: "pollaaa1", opts: ["Friday", "Saturday", "Sunday"], counts: [0, 2, 0], total: 2, max: 1, closes: null })]);
    expect(await myBoardVotes(db as never, "g1", "m1")).toEqual({ pollaaa1: [1] });
    expect(await boardForAddon(fakeDb({ boardOn: false, polls: [poll()] }) as never, "g1")).toEqual({ enabled: false });
  });
});

describe("votes from the game", () => {
  it("keeps only well-formed rows, once per poll (and per name for relayed ones)", () => {
    expect(parseAddonBoardVotes([{ poll: "pollaaa1", picks: [2, 0, 2], at: NOW }, { poll: "pollaaa1", picks: [1], at: NOW }, { poll: "bad id!", picks: [0], at: NOW },
      { poll: "pollbbb2", picks: [99], at: NOW }, { poll: "pollccc3", picks: [0], at: NOW + 86_400 }, "junk"])).toEqual([{ poll: "pollaaa1", picks: [0, 2], at: NOW }]);
    expect(parseAddonBoardVotes([{ poll: "pollaaa1", picks: [0], at: NOW }], true)).toEqual([]);
    expect(parseAddonBoardVotes([{ poll: "pollaaa1", picks: [0], at: NOW, name: "Ann Walker" }, { poll: "pollaaa1", picks: [1], at: NOW, name: "ann walker" }], true))
      .toEqual([{ poll: "pollaaa1", picks: [0], at: NOW, name: "Ann Walker" }]);
  });

  it("records a vote like Discord does: one member, changeable, open polls only, never over a newer Discord vote", async () => {
    const db = fakeDb({ polls: [poll(), poll({ id: "pollmulti", maxChoices: 2 }), poll({ id: "pollclosed", closed: true })] });
    expect(await applyBoardVotes(db as never, "g1", "m1", [{ poll: "pollaaa1", picks: [0], at: NOW - 100 }])).toEqual(["pollaaa1"]);
    expect(db.votes.map((v) => v.option)).toEqual([0]);
    // The same upload again changes nothing.
    expect(await applyBoardVotes(db as never, "g1", "m1", [{ poll: "pollaaa1", picks: [0], at: NOW - 100 }])).toEqual([]);
    // Changing the vote replaces it.
    expect(await setBoardPicks(db as never, "g1", "m1", { poll: "pollaaa1", picks: [2], at: NOW - 50 })).toBe(true);
    expect(db.votes.filter((v) => v.pollId === "pollaaa1").map((v) => v.option)).toEqual([2]);
    // A game vote older than the latest vote does not undo it.
    expect(await setBoardPicks(db as never, "g1", "m1", { poll: "pollaaa1", picks: [1], at: NOW - 80 })).toBe(false);
    // Too many picks, missing options and closed polls are refused.
    expect(await setBoardPicks(db as never, "g1", "m1", { poll: "pollaaa1", picks: [0, 1], at: NOW })).toBe(false);
    expect(await setBoardPicks(db as never, "g1", "m1", { poll: "pollmulti", picks: [0, 7], at: NOW })).toBe(false);
    expect(await setBoardPicks(db as never, "g1", "m1", { poll: "pollclosed", picks: [0], at: NOW })).toBe(false);
    expect(await setBoardPicks(db as never, "g1", "m1", { poll: "pollmulti", picks: [0, 2], at: NOW })).toBe(true);
    // An empty list takes the vote back.
    expect(await setBoardPicks(db as never, "g1", "m1", { poll: "pollmulti", picks: [], at: NOW + 1 })).toBe(true);
    expect(db.votes.filter((v) => v.pollId === "pollmulti")).toEqual([]);
    // Off switch: game votes are ignored.
    const off = fakeDb({ boardOn: false, polls: [poll()] });
    expect(await applyBoardVotes(off as never, "g1", "m1", [{ poll: "pollaaa1", picks: [0], at: NOW }])).toEqual([]);
  });

  it("records relayed votes for the member who linked that character, never for the uploader or unknown names", async () => {
    const db = fakeDb({ polls: [poll()], characters: [{ name: "Ann", displayName: "Ann Walker", memberId: "mAnn" }, { name: "Kev", displayName: null, memberId: "mKev" }] });
    const changed = await applyRelayedBoardVotes(db as never, "g1", "mKev", [
      { poll: "pollaaa1", picks: [1], at: NOW, name: "ann walker" },
      { poll: "pollaaa1", picks: [2], at: NOW, name: "Kev" },
      { poll: "pollaaa1", picks: [0], at: NOW, name: "Nobody" }
    ]);
    expect(changed).toEqual(["pollaaa1"]);
    expect(db.votes).toEqual([expect.objectContaining({ memberId: "mAnn", option: 1 })]);
  });
});

describe("officers' news", () => {
  it("posts from Discord and from the game, each game ref once, and takes posts down", async () => {
    const db = fakeDb();
    const service = createBoardService(db as never);
    await expect(service.post({ guildId: "g1", body: " x ", author: "Ann" })).rejects.toThrow(/at least 3/);
    const post = await service.post({ guildId: "g1", body: "Raid moved to 8 pm", author: "Ann", authorId: "1" });
    expect(post).toMatchObject({ source: "discord", body: "Raid moved to 8 pm" });
    const rows = parseAddonBoardPosts([{ ref: "1767000000-123456", text: "Bring | potions", at: NOW }, { ref: "x", text: "too short ref", at: NOW }, { ref: "1767000000-222222", text: "no", at: NOW }]);
    expect(rows).toEqual([{ ref: "1767000000-123456", text: "Bring potions", at: NOW }]);
    expect(await service.fromAddon("g1", "m1", "Kev Caron", rows)).toHaveLength(1);
    expect(await service.fromAddon("g1", "m1", "Kev Caron", rows)).toHaveLength(0);
    const board = await boardForAddon(db as never, "g1");
    expect(board.news?.find((n) => n.ref === "1767000000-123456")).toMatchObject({ by: "Kev Caron", text: "Bring potions" });
    await service.remove(post.id, "g1");
    await expect(service.remove(post.id, "g1")).rejects.toThrow(/not on the board/);
    expect((await boardForAddon(db as never, "g1")).news).toHaveLength(1);
    expect(boardText("a\u0007b||c", 10)).toBe("a b c");
  });
});

describe("the companion", () => {
  it("writes the board for the addon with options and picks numbered from 1, or off", () => {
    const lua = guildBoardToLua({ enabled: true, news: [{ id: "n1", at: NOW, by: "Ann", text: "Say \"hi\"", ref: "r-123456" }],
      polls: [{ id: "pollaaa1", q: "Night?", opts: ["Fri", "Sat"], counts: [1, 3], total: 4, max: 1, closes: null, at: NOW }, { id: "solo", opts: ["only"] }] },
    { pollaaa1: [1] }, "2026-11-07T12:00:00.000Z").join("\n");
    expect(lua).toContain('GuildedBoard = { at = "2026-11-07T12:00:00.000Z", news = {');
    expect(lua).toContain('text = "Say \\"hi\\"", ref = "r-123456"');
    expect(lua).toContain('opts = { "Fri", "Sat" }, counts = { 1, 3 }, mine = { 2 }');
    expect(lua).not.toContain("solo");
    expect(guildBoardToLua({ enabled: false }, {}, "x")).toEqual(['GuildedBoard = { at = "x", off = true }']);
    expect(guildBoardToLua(undefined, undefined, "x")).toEqual(["GuildedBoard = nil"]);
  });

  it("uploads waiting votes (from 0), heard votes with the sender and officers' news", () => {
    const out = exportGuildBoard({ board: {
      votes: { pollaaa1: { picks: [2, 1], at: NOW, boardAt: "x" }, "bad id": { picks: [1], at: NOW }, pollold1: { picks: [1], at: 5 } },
      heard: { "pollaaa1@Ann Walker": { poll: "pollaaa1", picks: { 1: 3 }, at: NOW, name: "Ann Walker" }, junk: { poll: "pollaaa1", picks: [1], at: NOW, name: "A|B" } },
      posts: { "1767000000-123456": { ref: "1767000000-123456", text: "Bring\npots", at: NOW } }
    } });
    expect(out).toEqual({
      boardVotes: [{ poll: "pollaaa1", picks: [0, 1], at: NOW }],
      boardRelayVotes: [{ poll: "pollaaa1", picks: [2], at: NOW, name: "Ann Walker" }],
      boardPosts: [{ ref: "1767000000-123456", text: "Bring pots", at: NOW }]
    });
    expect(exportGuildBoard({})).toEqual({});
  });
});
