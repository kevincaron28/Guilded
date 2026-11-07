import { describe, expect, it, vi } from "vitest";
import { handleInviteDm, handleInviteRequestInteraction, requestInviteModal, requestInviteRow, submitInviteRequest } from "../src/services/invite-request.js";
import { parseInviteName } from "../src/services/invite-queue.js";


const settings = { guildId: "g1", inviteChannelId: "chan", language: "en" };
function setup(overrides: { requests?: Record<string, unknown>[]; settings?: unknown; member?: boolean; asked?: string[] } = {}) {
  const requests = overrides.requests ?? [];
  const react = vi.fn(async () => undefined);
  const send = vi.fn(async (options: unknown) => { void options; return { id: "posted-1", react }; });
  const database = {
    guildSettings: {
      findFirst: vi.fn(async () => overrides.settings === undefined ? settings : overrides.settings),
      findMany: vi.fn(async () => [{ guild: { discordId: "guild" } }])
    },
    inviteRequest: {
      findFirst: vi.fn(async ({ where }: { where: { nameKey: string; discordUserId: string } }) => requests.find((r) => r["nameKey"] === where.nameKey && r["discordUserId"] === where.discordUserId) ?? null),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { requests.push(create); return create; })
    },
    inviteDm: { findMany: vi.fn(async () => (overrides.asked ?? ["g1"]).map((guildId) => ({ guildId }))) }
  };
  const client = {
    guilds: { fetch: vi.fn(async () => ({ members: { fetch: vi.fn(async () => overrides.member === false ? null : { id: "u1" }) } })) },
    channels: { fetch: vi.fn(async () => ({ id: "chan", isTextBased: () => true, send })) }
  };
  return { database, client, requests, send, react };
}
const parsed = parseInviteName("Lebowski Holyroller")!;

describe("the Request a guild invite button and form", () => {
  it("is a primary button carrying the server and a form asking for First Last", () => {
    const row = requestInviteRow("en", "guild").toJSON();
    expect(row.components[0]).toMatchObject({ custom_id: "invite:ask:guild", label: "Request a guild invite" });
    expect(requestInviteRow("fr", "guild").toJSON().components[0]).toMatchObject({ label: "Demander une invitation de guilde" });
    const modal = requestInviteModal("en", "guild").toJSON();
    expect(modal.custom_id).toBe("invite:name:guild");
    expect(JSON.stringify(modal)).toContain("Lebowski Holyroller");
  });
  it("opens the form on the button", async () => {
    const { database } = setup();
    const showModal = vi.fn(async () => undefined);
    await handleInviteRequestInteraction({ customId: "invite:ask:guild", isButton: () => true, isModalSubmit: () => false, showModal } as never, database as never);
    expect(showModal).toHaveBeenCalledTimes(1);
  });
  const submit = (text: string, deps: ReturnType<typeof setup>) => {
    const reply = vi.fn(async () => undefined); const editReply = vi.fn(async (options: unknown) => { void options; });
    const interaction = { customId: "invite:name:guild", isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => text },
      user: { id: "u1" }, client: deps.client, reply, deferReply: vi.fn(async () => undefined), editReply };
    return { interaction, reply, editReply };
  };
  it("rejects a name that is not First Last, privately, and posts nothing", async () => {
    const deps = setup(); const { interaction, reply } = submit("justonename", deps);
    await handleInviteRequestInteraction(interaction as never, deps.database as never);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("First Last") }));
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("posts the name without pinging, queues it with eyes, and confirms", async () => {
    const deps = setup(); const { interaction, editReply } = submit("Lebowski Holyroller", deps);
    await handleInviteRequestInteraction(interaction as never, deps.database as never);
    expect(deps.send).toHaveBeenCalledWith({ content: "<@u1> → **Lebowski Holyroller**", components: [expect.anything()], allowedMentions: { parse: [] } });
    expect(deps.requests[0]).toMatchObject({ guildId: "g1", displayName: "Lebowski Holyroller", discordUserId: "u1", messageId: "posted-1", channelId: "chan" });
    expect(deps.react).toHaveBeenCalledWith("👀");
    expect(editReply.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("<#chan>") });
  });
});

describe("one request per member per character", () => {
  it("ignores a repeat of the same character, but not a different one", async () => {
    const deps = setup({ requests: [{ nameKey: "lebowski holyroller", discordUserId: "u1" }] });
    expect((await submitInviteRequest(deps.client as never, deps.database as never, { discordGuildId: "guild", discordUserId: "u1", parsed })).status).toBe("duplicate");
    expect(deps.send).not.toHaveBeenCalled();
    const other = parseInviteName("Amy Archer")!;
    expect((await submitInviteRequest(deps.client as never, deps.database as never, { discordGuildId: "guild", discordUserId: "u1", parsed: other })).status).toBe("posted");
  });
  it("is unavailable without a channel, for a non-member", async () => {
    const noChannel = setup({ settings: null });
    expect((await submitInviteRequest(noChannel.client as never, noChannel.database as never, { discordGuildId: "guild", discordUserId: "u1", parsed })).status).toBe("unavailable");
    const gone = setup({ member: false });
    expect((await submitInviteRequest(gone.client as never, gone.database as never, { discordGuildId: "guild", discordUserId: "u1", parsed })).status).toBe("unavailable");
  });
});

describe("a plain DM reply", () => {
  const dm = (content: string, deps: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) => {
    const reply = vi.fn(async (options: unknown) => { void options; });
    return { message: { guildId: null, content, author: { id: "u1", bot: false }, client: deps.client, reply, ...extra }, reply };
  };
  it("queues a full name from a member the bot already asked, and answers in the DM", async () => {
    const deps = setup(); const { message, reply } = dm("Lebowski Holyroller", deps);
    expect(await handleInviteDm(message as never, deps.database as never)).toBe(true);
    expect(deps.requests).toHaveLength(1);
    expect(reply.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("<#chan>") });
  });
  it("ignores chatter, servers, bots, and members the bot never asked", async () => {
    const deps = setup();
    expect(await handleInviteDm(dm("hello there, how are you", deps).message as never, deps.database as never)).toBe(false);
    expect(await handleInviteDm(dm("Lebowski Holyroller", deps, { guildId: "guild" }).message as never, deps.database as never)).toBe(false);
    expect(await handleInviteDm(dm("Lebowski Holyroller", deps, { author: { id: "b", bot: true } }).message as never, deps.database as never)).toBe(false);
    const unasked = setup({ asked: [] });
    expect(await handleInviteDm(dm("Lebowski Holyroller", unasked).message as never, unasked.database as never)).toBe(false);
    expect(deps.requests).toHaveLength(0);
  });
  it("says so once for a duplicate", async () => {
    const deps = setup({ requests: [{ nameKey: "lebowski holyroller", discordUserId: "u1" }] }); const { message, reply } = dm("Lebowski Holyroller", deps);
    expect(await handleInviteDm(message as never, deps.database as never)).toBe(true);
    expect(reply.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("already asked") });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
