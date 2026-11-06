import { Collection, ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { archiveChannelText, archiveForRetire, deleteRetiredChannel, forgetRetirePlan, isManagedChannel, retirePlan } from "../src/services/channel-retire.js";

const message = (n: number) => ({ id: String(n), content: `hello ${n}`, createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)), author: { id: `u${n}`, username: `user${n}` }, attachments: new Collection() });
function channel(total: number) {
  const all = Array.from({ length: total }, (_, i) => message(total - i)); // newest first, as Discord returns
  return { id: "old", name: "wow-personnage", type: ChannelType.GuildText, delete: vi.fn(async () => undefined),
    messages: { fetch: vi.fn(async ({ limit, before }: { limit: number; before?: string }) => {
      const start = before ? all.findIndex((m) => m.id === before) + 1 : 0;
      return new Collection(all.slice(start, start + limit).map((m) => [m.id, m]));
    }) } };
}
const guild = (old: ReturnType<typeof channel> | null) => ({ id: "guild", channels: { fetch: vi.fn(async () => old) } });
const destination = () => ({ id: "log", send: vi.fn(async (...args: unknown[]) => { void args; }) });

describe("archiving a channel", () => {
  it("reads every page, oldest first", async () => {
    const { text, count } = await archiveChannelText(channel(250) as never);
    expect(count).toBe(250);
    const lines = text.split("\n").filter((line) => line.startsWith("["));
    expect(lines[0]).toContain("hello 1"); expect(lines[249]).toContain("hello 250");
  });
  it("posts the file first and only remembers a plan; nothing is deleted", async () => {
    const old = channel(3); const log = destination();
    const plan = await archiveForRetire(guild(old) as never, old as never, log as never);
    expect(log.send.mock.calls[0]![0]).toMatchObject({ files: [expect.objectContaining({ name: expect.stringMatching(/^archive-wow-personnage-\d{4}-\d\d-\d\d\.txt$/) })] });
    expect(plan).toMatchObject({ channelId: "old", archived: 3 });
    expect(old.delete).not.toHaveBeenCalled();
    forgetRetirePlan("guild");
  });
});

describe("deleting only after confirmation", () => {
  it("refuses with no archived plan", async () => {
    const old = channel(1);
    const result = await deleteRetiredChannel(guild(old) as never, {}, "test");
    expect(result.ok).toBe(false); expect(old.delete).not.toHaveBeenCalled();
  });
  it("deletes the archived channel once, then forgets the plan", async () => {
    const old = channel(2);
    await archiveForRetire(guild(old) as never, old as never, destination() as never);
    const result = await deleteRetiredChannel(guild(old) as never, {}, "test");
    expect(result).toMatchObject({ ok: true, name: "wow-personnage", archived: 2 });
    expect(old.delete).toHaveBeenCalledTimes(1);
    expect((await deleteRetiredChannel(guild(old) as never, {}, "test")).ok).toBe(false);
    expect(old.delete).toHaveBeenCalledTimes(1);
  });
  it("never deletes a channel Guilded uses, even if it was archived", async () => {
    const old = channel(1);
    await archiveForRetire(guild(old) as never, old as never, destination() as never);
    expect((await deleteRetiredChannel(guild(old) as never, { inviteChannelId: "old" }, "test")).ok).toBe(false);
    expect(old.delete).not.toHaveBeenCalled(); expect(retirePlan("guild")).toBeUndefined();
    expect(isManagedChannel({ logChannelId: "old", bgGroupsChannelId: null }, "old")).toBe(true);
    expect(isManagedChannel({ logChannelId: "x" }, "old")).toBe(false);
  });
  it("lets an old plan expire", async () => {
    const old = channel(1);
    await archiveForRetire(guild(old) as never, old as never, destination() as never);
    expect((await deleteRetiredChannel(guild(old) as never, {}, "test", Date.now() + 20 * 60_000)).ok).toBe(false);
    expect(old.delete).not.toHaveBeenCalled();
  });
});
