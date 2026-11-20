import { beforeEach, expect, it, vi } from "vitest";
import { Collection } from "discord.js";
const mocks = vi.hoisted(() => ({ address: vi.fn(), planned: vi.fn(), calendar: vi.fn(), settings: vi.fn(), answers: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { guild: { findFirst: async () => ({ id: "guild", discordId: "server", scopeKey: "default", gameEdition: "forever" }) }, raid: { findMany: mocks.planned }, guildSettings: { findUnique: mocks.settings } } }));
vi.mock("../src/services/notify.js", () => ({ resolveNotifyAddress: mocks.address }));
vi.mock("../src/services/calendar-sync.js", () => ({ runCalendarPlan: mocks.calendar }));
vi.mock("../src/services/signup-answers.js", () => ({ applySignupAnswers: mocks.answers }));
import { dispatchDiscordJob } from "../src/services/discord-jobs.js";

beforeEach(() => vi.resetAllMocks());
const job = (payload: unknown) => ({ id: "delivery", key: "notification:test", guildId: "guild", kind: "MESSAGE", payload });
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

it("applies the raid answers members gave in game for this guild only", async () => {
  mocks.answers.mockResolvedValue({ applied: 1, unchanged: 0, failed: 0, changedRaidIds: [] });
  const answers = [{ raidId: "r1", memberId: "m1", status: "ACCEPTED", role: "TANK", at: "2026-11-10T12:00:00.000Z" }];
  await dispatchDiscordJob({} as never, { ...job({ answers }), kind: "SIGNUP_ANSWERS" } as never);
  expect(mocks.answers).toHaveBeenCalledWith(expect.anything(), "guild", answers);
  await dispatchDiscordJob({} as never, { ...job({ answers: "nonsense" }), kind: "SIGNUP_ANSWERS" } as never);
  expect(mocks.answers).toHaveBeenLastCalledWith(expect.anything(), "guild", []);
});

it("notifies nobody unless a job names its users, and only valid user IDs", async () => {
  const d = discord();
  await dispatchDiscordJob(d.guild as never, job({ channelId: "fame", message: { content: "⭐ Bravo" } }) as never);
  expect(d.send.mock.calls[0]?.[0].allowedMentions).toEqual({ parse: [], users: [] });
  await dispatchDiscordJob(d.guild as never, job({ channelId: "fame", mentionUsers: ["337035968668499981", "@everyone", 5], message: { content: "⭐ Bravo <@337035968668499981>" } }) as never);
  expect(d.send.mock.calls[1]?.[0].allowedMentions).toEqual({ parse: [], users: ["337035968668499981"] });
});

it("draws a stored card when a queued message is delivered and still posts without one", async () => {
  mocks.address.mockResolvedValue({ guildId: "guild", channelId: "raid-logs" });
  const card = { title: "Molten Core", subtitle: "Completed", stats: [{ label: "Bosses", value: "7/10" }], footer: "Guild raid report" };
  const d = discord();
  await dispatchDiscordJob(d.guild as never, job({ route: "raidLog", channelId: "raid-logs", message: { embeds: [{ title: "Report" }] }, card }) as never);
  const sent = d.send.mock.calls[0]![0];
  expect(sent.files).toHaveLength(1);
  expect(sent.files[0].name).toBe("card.png");
  expect(sent.embeds[0].data.image.url).toBe("attachment://card.png");
  const plain = discord();
  await dispatchDiscordJob(plain.guild as never, job({ route: "raidLog", channelId: "raid-logs", message: { embeds: [{ title: "Report" }] } }) as never);
  expect(plain.send.mock.calls[0]![0].files).toBeUndefined();
});

it("keeps the delivery id out of the footer members read, and still skips a post it already made", async () => {
  mocks.address.mockResolvedValue({ guildId: "guild", channelId: "c" });
  const d = discord();
  await dispatchDiscordJob(d.guild as never, job({ route: "officer", channelId: "c", message: { embeds: [{ description: "Bilan du jour", footer: { text: "Un bilan par jour" } }] } }) as never);
  const sent = d.send.mock.calls[0]![0].embeds[0].data;
  expect(sent.footer.text).toBe("Un bilan par jour");
  expect(JSON.stringify(sent.footer)).not.toContain("delivery");
  expect(sent.url).toBe("https://guildedwow.com/?delivery=delivery");
  // A retry after a crash finds the post by that invisible link, or by the footer posts carried before 9.0.5.
  for (const embed of [{ url: "https://guildedwow.com/?delivery=delivery" }, { footer: { text: "Un bilan · Guilded delivery delivery" } }]) {
    const again = discord();
    again.fetch.mockResolvedValue({ isTextBased: () => true, messages: { fetch: async () => new Collection([["m", { author: { id: "bot" }, embeds: [embed] }]]) }, send: again.send } as never);
    await dispatchDiscordJob(again.guild as never, job({ route: "officer", channelId: "c", message: { embeds: [{ description: "x" }] } }) as never);
    expect(again.send).not.toHaveBeenCalled();
  }
});

it("delivers a second card in the same post and takes its text line off only when that card drew", async () => {
  mocks.address.mockResolvedValue({ guildId: "guild", channelId: "fame" });
  const card = (title: string) => ({ title, subtitle: "s", stats: [{ label: "Points", value: "1" }], footer: "f" });
  const rookieField = { name: "Rookie", value: "Newbie" };
  const payload = (extraCard: unknown) => job({ channelId: "fame", message: { embeds: [{ description: "full", fields: [rookieField] }] }, card: card("MVP"),
    cardOnly: { embeds: [{ description: "reduced", fields: [rookieField] }, { color: 1 }, { color: 2 }] }, ...(extraCard ? { extraCard } : {}) }) as never;
  const d = discord();
  await dispatchDiscordJob(d.guild as never, payload({ card: card("Newbie"), dropField: rookieField.name }));
  const sent = d.send.mock.calls[0]![0];
  expect(sent.files.map((file: { name: string }) => file.name)).toEqual(["card.png", "card2.png"]);
  expect(sent.embeds).toHaveLength(3);
  expect(sent.embeds[0].data.fields ?? []).toHaveLength(0);
  expect(sent.embeds[1].data.image.url).toBe("attachment://card.png");
  expect(sent.embeds[2].data.image.url).toBe("attachment://card2.png");
  // The second card cannot be drawn: one picture, the rookie line stays, no empty embed.
  const lone = discord();
  await dispatchDiscordJob(lone.guild as never, payload({ card: null, dropField: rookieField.name }));
  const one = lone.send.mock.calls[0]![0];
  expect(one.files).toHaveLength(1);
  expect(one.embeds).toHaveLength(2);
  expect(one.embeds[0].data.fields).toHaveLength(1);
});
