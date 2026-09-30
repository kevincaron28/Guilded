import { ChannelType, Collection } from "discord.js";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), start: vi.fn(), signups: vi.fn(), leader: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { dungeonGroup: { findUnique: mocks.find, update: mocks.start }, dungeonGroupSignup: { findMany: mocks.signups }, member: { findUnique: mocks.leader } } }));
import { startGroup, syncDungeonVoiceAccess } from "../src/commands/dungeon-group.js";
import { serializeDungeonGroup } from "../src/services/dungeon-group-queue.js";
beforeEach(() => vi.clearAllMocks());
it("does not create another voice channel for a started or closed group", async () => {
  const create = vi.fn(); const guild = { channels: { create } };
  mocks.find.mockResolvedValue({ status: "STARTED", voiceChannelId: "existing" });
  expect(await startGroup(guild as never, "group")).toBe("existing");
  mocks.find.mockResolvedValue({ status: "CLOSED" });
  expect(await startGroup(guild as never, "group")).toBeNull();
  expect(create).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
});
it("serializes a start and close for the same group and recovers after errors", async () => {
  const events: string[] = []; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const start = serializeDungeonGroup("same", async () => { events.push("start"); await gate; events.push("started"); });
  const close = serializeDungeonGroup("same", async () => { events.push("close"); });
  await Promise.resolve(); await Promise.resolve();
  expect(events).toEqual(["start"]);
  release(); await Promise.all([start, close]); expect(events).toEqual(["start", "started", "close"]);
  await expect(serializeDungeonGroup("same", async () => { throw new Error("Discord unavailable"); })).rejects.toThrow("Discord unavailable");
  expect(await serializeDungeonGroup("same", async () => "recovered")).toBe("recovered");
});

it("voice access follows the current roster, granting promoted members and removing departed members", async () => {
  mocks.find.mockResolvedValue({ id: "group", status: "STARTED", voiceChannelId: "voice", leaderId: "leader" });
  mocks.signups.mockResolvedValue([{ member: { discordUserId: "promoted" } }]);
  mocks.leader.mockResolvedValue({ discordUserId: "leader-discord" });
  const set = vi.fn();
  const guild = { channels: { fetch: async () => ({ type: ChannelType.GuildVoice, permissionOverwrites: { set } }) }, roles: { fetch: vi.fn(), cache: new Collection(), everyone: { id: "everyone" } }, members: { me: { id: "bot" } } };
  await syncDungeonVoiceAccess(guild as never, "group");
  const ids = set.mock.calls[0]![0].map((row: { id: string }) => row.id);
  expect(ids).toEqual(["everyone", "promoted", "leader-discord", "bot"]);
  expect(ids).not.toContain("departed");
});
