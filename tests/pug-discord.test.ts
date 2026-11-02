import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    pugRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    pugSignup: { findUnique: vi.fn() },
    pugPost: { findFirst: vi.fn() },
    guildSettings: { findUnique: vi.fn() },
    raid: { findUnique: vi.fn() }
  },
  hasPermission: vi.fn(),
  allows: vi.fn(() => true)
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/permissions.js", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../src/hosted-pilot.js", () => ({ hostedPilot: { allows: mocks.allows } }));
vi.mock("../src/services/guild-scope.js", () => ({ guildWhere: vi.fn(), withGuildScope: async (_db: unknown, _id: string, work: () => unknown) => work() }));

import { handlePugComponent } from "../src/commands/pug-requests.js";
import { deliverPugPost, pugNoticePayload, pugPostPayload } from "../src/services/pug-discord.js";

const when = new Date("2026-11-07T20:00:00Z");
const request = { id: "req1", raidTitle: "Karazhan", scheduledAt: when, expiresAt: when, edition: "classic-tbc", note: "flasks", wantTank: 1, wantHealer: 0, wantDps: 2, guild: { name: "Alpha" } };
const json = (payload: ReturnType<typeof pugPostPayload>) => JSON.stringify({ embeds: payload.embeds?.map(e => ("toJSON" in e ? e.toJSON() : e)), components: payload.components?.map(c => ("toJSON" in c ? c.toJSON() : c)) });

describe("PUG post message", () => {
  it("is unmistakably another guild's raid and offers sign-up only for open roles, with no internal ids", () => {
    const text = json(pugPostPayload(request, [{ role: "TANK", status: "ACCEPTED" }], { lang: "en", timezone: "America/Toronto" }));
    expect(text).toContain("OTHER GUILD'S RAID");
    expect(text).toContain("Alpha");
    expect(text).toContain("America/Toronto");
    expect(text).toContain(`<t:${Math.floor(when.getTime() / 1000)}:F>`);
    expect(text).toContain("TBC Classic");
    expect(text).toContain("pugb:s:req1:DPS");
    expect(text).not.toContain("pugb:s:req1:TANK"); // the only tank spot is taken
    expect(text).not.toContain("pugb:s:req1:HEALER"); // none wanted
    expect(text).not.toMatch(/"g1"|discordUserId|createdBy/);
  });

  it("speaks French to a French guild", () => {
    expect(json(pugPostPayload(request, [], { lang: "fr", timezone: "America/Toronto" }))).toContain("RAID D'UNE AUTRE GUILDE");
  });

  it("the officer notice lists waiting and accepted guests and offers review/close only while open", () => {
    const signups = [
      { id: "s1", displayName: "Alice", sourceGuild: "Beta", characterName: "Aliceth", characterClass: "Warrior", role: "TANK", note: null, status: "PENDING" },
      { id: "s2", displayName: "Bob", sourceGuild: null, characterName: "Bobby", characterClass: null, role: "DPS", note: "late 5m", status: "ACCEPTED" }
    ];
    const open = json(pugNoticePayload({ ...request, status: "OPEN" }, signups, "en"));
    expect(open).toContain("pugb:rv:req1");
    expect(open).toContain("pugb:cl:req1");
    expect(open).toContain("Aliceth");
    expect(open).toContain("Bobby");
    expect(json(pugNoticePayload({ ...request, status: "CLOSED" }, signups, "en"))).not.toContain("pugb:cl:req1");
  });
});

describe("PUG delivery", () => {
  const job = { id: "job1", guildId: "g2", payload: { requestId: "req1" } } as never;
  const post = (over: Record<string, unknown> = {}) => ({ id: "post1", requestId: "req1", guildId: "g2", channelId: "c2", messageId: null, removedAt: null, request: { ...request, guildId: "g1", status: "OPEN", signups: [] }, ...over });
  const db = (found: unknown, boards: { guildId: string; channelId: string; guild: { discordId: string } }[] = [{ guildId: "g2", channelId: "c2", guild: { discordId: "d2" } }]) => ({
    pugPost: { findUnique: vi.fn().mockResolvedValue(found), update: vi.fn().mockResolvedValue({}) },
    guildSettings: { findUnique: vi.fn().mockResolvedValue({ timezone: "America/Toronto", language: "en" }) },
    pugBoardGuild: { findMany: vi.fn().mockResolvedValue(boards) },
    pugBlock: { findMany: vi.fn().mockResolvedValue([]) }
  });
  const now = new Date("2026-11-05T12:00:00Z");

  it("sends once and remembers the message id", async () => {
    const send = vi.fn().mockResolvedValue({ id: "m1" });
    const guild = { channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }) } };
    const database = db(post());
    await deliverPugPost(guild as never, database as never, job, () => true, now);
    expect(send).toHaveBeenCalledOnce();
    expect(database.pugPost.update).toHaveBeenCalledWith(expect.objectContaining({ data: { messageId: "m1" } }));
  });

  it("a deleted channel retires the post quietly instead of throwing or retrying", async () => {
    const guild = { channels: { fetch: vi.fn().mockRejectedValue(Object.assign(new Error("Unknown Channel"), { code: 10003 })) } };
    const database = db(post());
    await expect(deliverPugPost(guild as never, database as never, job, () => true, now)).resolves.toBeUndefined();
    expect(database.pugPost.update).toHaveBeenCalledWith(expect.objectContaining({ data: { removedAt: now } }));
  });

  it("a closed request is edited to Closed and deleted, then retired", async () => {
    const message = { edit: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) };
    const guild = { channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send: vi.fn(), messages: { fetch: vi.fn().mockResolvedValue(message) } }) } };
    const database = db(post({ messageId: "m1", request: { ...request, guildId: "g1", status: "CLOSED", signups: [] } }));
    await deliverPugPost(guild as never, database as never, job, () => true, now);
    expect(message.edit).toHaveBeenCalledOnce();
    expect(message.delete).toHaveBeenCalledOnce();
    expect(database.pugPost.update).toHaveBeenCalledWith(expect.objectContaining({ data: { removedAt: now } }));
  });

  it("a guild that left the board gets the post removed even though the request is open", async () => {
    const message = { edit: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) };
    const guild = { channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send: vi.fn(), messages: { fetch: vi.fn().mockResolvedValue(message) } }) } };
    await deliverPugPost(guild as never, db(post({ messageId: "m1" }), []) as never, job, () => true, now);
    expect(message.delete).toHaveBeenCalledOnce();
  });

  it("does not re-post a message a moderator deleted", async () => {
    const send = vi.fn();
    const guild = { channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send, messages: { fetch: vi.fn().mockRejectedValue(Object.assign(new Error("Unknown Message"), { code: 10008 })) } }) } };
    await deliverPugPost(guild as never, db(post({ messageId: "gone" })) as never, job, () => true, now);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("PUG buttons are checked on the server", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.allows.mockReturnValue(true); mocks.prisma.guildSettings.findUnique.mockResolvedValue({ language: "en" }); });
  const button = (customId: string) => ({
    customId, guildId: "d1", guild: { id: "d1", name: "Alpha" }, channelId: "c1", locale: "en-US", member: { displayName: "Mallory" }, user: { id: "u1" },
    isButton: () => true, isModalSubmit: () => false, deferred: false, replied: false,
    reply: vi.fn(), editReply: vi.fn(), deferReply: vi.fn(), deferUpdate: vi.fn(), showModal: vi.fn(), message: { id: "m1" }
  });

  it("a non-officer cannot close a request or decide a guest", async () => {
    mocks.hasPermission.mockReturnValue(false);
    mocks.prisma.pugRequest.findUnique.mockResolvedValue({ id: "req1", guildId: "g1", guild: { discordId: "d1" } });
    mocks.prisma.pugSignup.findUnique.mockResolvedValue({ requestId: "req1" });
    for (const id of ["pugb:cl:req1", "pugb:rv:req1", "pugb:ok:s1", "pugb:no:s1"]) {
      const interaction = button(id);
      await handlePugComponent(interaction as never);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Only officers") }));
    }
    expect(mocks.prisma.pugRequest.updateMany).not.toHaveBeenCalled();
  });

  it("an officer of a different Discord server cannot act on another guild's request", async () => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.prisma.pugRequest.findUnique.mockResolvedValue({ id: "req1", guildId: "g1", guild: { discordId: "other-server" } });
    const interaction = button("pugb:cl:req1");
    await handlePugComponent(interaction as never);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("not available here") }));
    expect(mocks.prisma.pugRequest.updateMany).not.toHaveBeenCalled();
  });

  it("the Ask for PUGs button is officer-only before the form even opens", async () => {
    mocks.hasPermission.mockReturnValue(false);
    mocks.prisma.raid.findUnique.mockResolvedValue({ guildId: "g1" });
    const interaction = button("pugb:ask:r1");
    await handlePugComponent(interaction as never);
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Only officers") }));
  });
});
