import { beforeEach, expect, it, vi } from "vitest";
import { Collection } from "discord.js";
const mocks = vi.hoisted(() => ({ address: vi.fn(), planned: vi.fn(), calendar: vi.fn(), settings: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { raid: { findMany: mocks.planned }, guildSettings: { findUnique: mocks.settings } } }));
vi.mock("../src/services/notify.js", () => ({ resolveNotifyAddress: mocks.address }));
vi.mock("../src/services/calendar-sync.js", () => ({ runCalendarPlan: mocks.calendar }));
import { dispatchDiscordJob } from "../src/services/discord-jobs.js";

beforeEach(() => vi.resetAllMocks());
const job = (payload: unknown) => ({ id: "delivery", guildId: "guild", kind: "MESSAGE", payload });
function discord() {
  const send = vi.fn();
  const fetch = vi.fn(async () => ({ isTextBased: () => true, messages: { fetch: async () => new Collection() }, send }));
  return { guild: { client: { user: { id: "bot" } }, channels: { fetch } }, fetch, send };
}

it("routes a pending officer announcement to its replacement private channel", async () => {
  mocks.address.mockResolvedValue({ guildId: "guild", channelId: "replacement-private" });
  const d = discord();
  await dispatchDiscordJob(d.guild as never, job({ route: "officer", channelId: "deleted-private", message: { embeds: [{ description: "Private officer event", footer: { text: "Original footer" } }] } }) as never);
  expect(mocks.address).toHaveBeenCalledWith(d.guild, "officer", null);
  expect(d.fetch).toHaveBeenCalledWith("replacement-private");
  expect(d.send.mock.calls[0]?.[0].embeds[0].data.footer.text).toContain("Original footer");
});

it("does not fall back to a public channel when a private notification route is missing", async () => {
  mocks.address.mockResolvedValue(null);
  const d = discord();
  await expect(dispatchDiscordJob(d.guild as never, job({ route: "officer", channelId: "stale-private", message: {} }) as never)).rejects.toThrow(/Configure/);
  expect(d.fetch).not.toHaveBeenCalled();
});

it("does not publish a retired guild's announcement after a reset", async () => {
  mocks.address.mockResolvedValue({ guildId: "fresh-guild", channelId: "new-channel" });
  const d = discord();
  await dispatchDiscordJob(d.guild as never, job({ route: "loot", channelId: "old-channel", message: {} }) as never);
  expect(d.send).not.toHaveBeenCalled();
});

it("drops cancelled raids from a persisted calendar plan instead of retrying forever", async () => {
  mocks.planned.mockResolvedValue([]);
  mocks.calendar.mockResolvedValue({ changedRaidIds: [], failed: 0 });
  await dispatchDiscordJob({} as never, { ...job({ plan: { matches: [{ raidId: "cancelled" }], unmatched: [] } }), kind: "CALENDAR" } as never);
  expect(mocks.planned).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "guild", status: "PLANNED", isTest: false }) }));
  expect(mocks.calendar.mock.calls[0]?.[2].matches).toEqual([]);
});
