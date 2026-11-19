import { beforeEach, describe, expect, it, vi } from "vitest";

const claimCharacter = vi.fn();
const declinedKeys = vi.fn(async () => false);
const tellAutoLinked = vi.fn(async () => undefined);
const syncMemberNickname = vi.fn(async () => ({}));
const postToLogChannel = vi.fn(async () => undefined);
vi.mock("../src/services/character-autolink.js", () => ({ claimCharacter: (...a: unknown[]) => claimCharacter(...a), declinedKeys: (...a: unknown[]) => (declinedKeys as never as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../src/services/companion-link-dm.js", () => ({ tellAutoLinked: (...a: unknown[]) => (tellAutoLinked as never as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../src/services/nickname-sync.js", () => ({ syncMemberNickname: (...a: unknown[]) => (syncMemberNickname as never as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../src/services/housekeeping.js", () => ({ postToLogChannel: (...a: unknown[]) => (postToLogChannel as never as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../src/services/guild.js", () => ({ createGuildService: () => ({ ensureMember: async (_g: string, discordUserId: string, displayName: string) => ({ id: `m-${discordUserId}`, displayName }) }) }));

import { allowedBridgeApps, applyBridgeLink, bridgeNameForms, detectBridgeMessage, resetGameBridgeCaches, WOW_BRIDGE_APP_ID, type BridgeMessage } from "../src/services/game-bridge-link.js";

const packet = (overrides: Record<string, unknown> = {}) => ({
  id: "msg1", channel_id: "ch1", guild_id: "g-discord", author: { id: "u1", username: "kev", global_name: "Kev", bot: false },
  application_id: WOW_BRIDGE_APP_ID, flags: 65536, lobby_member: { additional_name: "Mister Haragot" }, content: "", ...overrides
});
const bridge = (name = "Mister Haragot", user = "u1"): BridgeMessage => ({ guildDiscordId: "g-discord", channelId: "ch1", messageId: "msg1", discordUserId: user, displayName: "Kev", characterName: name });

interface World {
  enabled?: boolean;
  members?: { id: string; discordUserId: string; displayName: string }[];
  characters?: { id: string; name: string; displayName?: string | null; memberId: string; linkEvidence?: string | null; confirmedAt?: Date | null; member: { displayName: string } }[];
  unclaimed?: { id: string; name: string; displayName?: string | null; realm?: string; gameEdition?: string }[];
}
function db(world: World) {
  const characters = world.characters ?? [];
  return {
    guild: { findFirst: vi.fn(async () => ({ id: "g1", settings: { gameBridgeLinkEnabled: world.enabled ?? true } })) },
    member: { findFirst: vi.fn(async ({ where }: { where: { discordUserId: string } }) => (world.members ?? []).find((m) => m.discordUserId === where.discordUserId) ?? null) },
    character: {
      findMany: vi.fn(async () => characters),
      count: vi.fn(async () => 0),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(characters.find((c) => c.id === where.id)!, data); }),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    unclaimedCharacter: { findMany: vi.fn(async () => world.unclaimed ?? []) }
  };
}
const logLang = (call: unknown[], lang: "en" | "fr") => (call[1] as (l: string) => string)(lang);
const client = {} as never;
const guild = {} as never;

beforeEach(() => {
  resetGameBridgeCaches();
  claimCharacter.mockReset(); declinedKeys.mockReset(); declinedKeys.mockResolvedValue(false);
  tellAutoLinked.mockClear(); syncMemberNickname.mockClear(); postToLogChannel.mockClear();
  claimCharacter.mockImplementation(async (_d: unknown, _g: string, _m: string, id: string) => ({ row: { name: id === "un1" ? "Mister Haragot" : id }, isMain: true }));
});

describe("detecting a relayed guild-chat message", () => {
  it("accepts the game's relay and returns the player and the full character name", () => {
    expect(detectBridgeMessage(packet())).toMatchObject({ guildDiscordId: "g-discord", discordUserId: "u1", characterName: "Mister Haragot", displayName: "Kev" });
  });
  it("ignores a normal message, a message without the flag and a bot author", () => {
    expect(detectBridgeMessage(packet({ lobby_member: undefined, application_id: undefined, flags: 0 }))).toBeNull();
    expect(detectBridgeMessage(packet({ flags: 0 }))).toBeNull();
    expect(detectBridgeMessage(packet({ author: { id: "u1", username: "x", bot: true } }))).toBeNull();
    expect(detectBridgeMessage(packet({ lobby_member: { additional_name: "  " } }))).toBeNull();
  });
  it("ignores another application id unless the allow-list names it", () => {
    expect(detectBridgeMessage(packet({ application_id: "999999999999" }))).toBeNull();
    expect(detectBridgeMessage(packet({ application_id: "999999999999" }), allowedBridgeApps("999999999999"))).not.toBeNull();
    expect(allowedBridgeApps("")).toEqual([WOW_BRIDGE_APP_ID]);
  });
  it("needs no message content, and takes the guild id from the caller for REST messages", () => {
    const { guild_id, ...rest } = packet();
    expect(guild_id).toBe("g-discord");
    expect(detectBridgeMessage(rest)).toBeNull();
    expect(detectBridgeMessage(rest, [WOW_BRIDGE_APP_ID], "g2")?.guildDiscordId).toBe("g2");
  });
});

describe("linking from the relayed name", () => {
  it("links an unclaimed character with game proof, tells the member once and refreshes the nickname", async () => {
    const database = db({ unclaimed: [{ id: "un1", name: "Mister Haragot", displayName: "Mister Haragot" }] });
    const result = await applyBridgeLink(database as never, bridge(), { client, discordGuild: guild });
    expect(result).toEqual({ outcome: "linked", character: "Mister Haragot" });
    expect(claimCharacter).toHaveBeenCalledWith(database, "g1", "m-u1", "un1");
    expect(database.character.updateMany).toHaveBeenCalledWith({ where: { memberId: "m-u1", name: "Mister Haragot", guildId: "g1" }, data: expect.objectContaining({ linkEvidence: "game" }) });
    expect(tellAutoLinked).toHaveBeenCalledTimes(1);
    expect(syncMemberNickname).toHaveBeenCalledWith(database, guild, { memberId: "m-u1" });
  });
  it("upgrades a named or reported link of the same member to confirmed game proof", async () => {
    const database = db({ members: [{ id: "m1", discordUserId: "u1", displayName: "Kev" }],
      characters: [{ id: "c1", name: "Mister Haragot", memberId: "m1", linkEvidence: "named", member: { displayName: "Kev" } }] });
    expect(await applyBridgeLink(database as never, bridge(), { client, discordGuild: guild })).toEqual({ outcome: "upgraded", character: "Mister Haragot" });
    expect(database.character.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: expect.objectContaining({ linkEvidence: "game", confirmedAt: expect.any(Date) }) });
    expect(tellAutoLinked).not.toHaveBeenCalled();
  });
  it("leaves officer or game proof alone", async () => {
    const database = db({ members: [{ id: "m1", discordUserId: "u1", displayName: "Kev" }],
      characters: [{ id: "c1", name: "Mister Haragot", memberId: "m1", linkEvidence: "officer", member: { displayName: "Kev" } }] });
    expect((await applyBridgeLink(database as never, bridge())).outcome).toBe("already");
    expect(database.character.update).not.toHaveBeenCalled();
  });
  it("never moves a character another member holds: one officer line per character per day, names only", async () => {
    const database = db({ members: [{ id: "m1", discordUserId: "u1", displayName: "Kev" }],
      characters: [{ id: "c9", name: "Mister Haragot", memberId: "m9", linkEvidence: "companion", member: { displayName: "Someone Else" } }] });
    expect((await applyBridgeLink(database as never, bridge(), { client, discordGuild: guild, now: 1_000 })).outcome).toBe("conflict");
    expect(await applyBridgeLink(database as never, bridge(), { client, discordGuild: guild, now: 2_000 })).toEqual({ outcome: "cached" });
    // another player claims the same character the same day: still one line
    await applyBridgeLink(database as never, bridge("Mister Haragot", "u2"), { client, discordGuild: guild, now: 3_000 });
    expect(postToLogChannel).toHaveBeenCalledTimes(1);
    expect(logLang(postToLogChannel.mock.calls[0] as unknown[], "en")).toContain("Nothing was moved");
    expect(logLang(postToLogChannel.mock.calls[0] as unknown[], "fr")).toContain("Rien n'a été déplacé");
    expect(claimCharacter).not.toHaveBeenCalled();
    expect(database.character.update).not.toHaveBeenCalled();
  });
  it("does nothing on a repeated message once the pair is cached", async () => {
    const database = db({ unclaimed: [{ id: "un1", name: "Mister Haragot" }] });
    await applyBridgeLink(database as never, bridge(), { client, discordGuild: guild, now: 1 });
    database.guild.findFirst.mockClear();
    expect(await applyBridgeLink(database as never, bridge(), { client, discordGuild: guild, now: 2 })).toEqual({ outcome: "cached" });
    expect(database.guild.findFirst).not.toHaveBeenCalled();
    expect(claimCharacter).toHaveBeenCalledTimes(1);
  });
  it("matches a doubled in-game name both ways, preferring the full-name row", async () => {
    expect(bridgeNameForms("Xaldin Xaldin")).toEqual(["xaldin xaldin", "xaldin"]);
    expect(bridgeNameForms("Xaldin")).toEqual(["xaldin", "xaldin xaldin"]);
    const database = db({ unclaimed: [{ id: "old", name: "Xaldin", displayName: "Xaldin Xaldin" }, { id: "full", name: "Xaldin Xaldin", displayName: "Xaldin Xaldin" }] });
    claimCharacter.mockResolvedValue({ row: { name: "Xaldin Xaldin" }, isMain: true });
    expect((await applyBridgeLink(database as never, bridge("Xaldin Xaldin"))).outcome).toBe("linked");
    expect(claimCharacter).toHaveBeenCalledWith(database, "g1", "m-u1", "full");
  });
  it("respects the member's own 'not mine' and says nothing when no roster row exists yet", async () => {
    declinedKeys.mockResolvedValue(true);
    const database = db({ members: [{ id: "m1", discordUserId: "u1", displayName: "Kev" }], unclaimed: [{ id: "un1", name: "Mister Haragot" }] });
    expect((await applyBridgeLink(database as never, bridge())).outcome).toBe("declined");
    expect(claimCharacter).not.toHaveBeenCalled();
    resetGameBridgeCaches(); declinedKeys.mockResolvedValue(false);
    expect((await applyBridgeLink(db({}) as never, bridge("Nobody Known"))).outcome).toBe("unknown");
  });
  it("a dry run changes and tells nothing", async () => {
    const database = db({ unclaimed: [{ id: "un1", name: "Mister Haragot" }] });
    expect(await applyBridgeLink(database as never, bridge(), { apply: false })).toEqual({ outcome: "linked", character: "Mister Haragot" });
    expect(claimCharacter).not.toHaveBeenCalled();
    expect(tellAutoLinked).not.toHaveBeenCalled();
  });
  it("does nothing when the officer switch is off", async () => {
    const database = db({ enabled: false, unclaimed: [{ id: "un1", name: "Mister Haragot" }] });
    expect((await applyBridgeLink(database as never, bridge())).outcome).toBe("off");
    expect(claimCharacter).not.toHaveBeenCalled();
  });
});
