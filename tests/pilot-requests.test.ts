import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ButtonInteraction, Client, Guild } from "discord.js";
import { createPilotRequests } from "../src/services/pilot-requests.js";
import { pilotFilePolicy } from "../src/services/pilot-admin.js";

const primary = "111111111111111111", guest = "222222222222222222", owner = "333333333333333333";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(limit = 5) {
  const dir = await mkdtemp(join(tmpdir(), "guilded-pilot-")); dirs.push(dir);
  const envPath = join(dir, ".env.local"), statePath = join(dir, "requests.json");
  await writeFile(envPath, `DISCORD_GUILD_ID=${primary}\nDISCORD_CLIENT_ID=${primary}\nHOSTED_PILOT=true\nHOSTED_GUILD_LIMIT=${limit}\n`);
  const ids = [primary], send = vi.fn(async () => ({ id: "message" })), activate = vi.fn(async () => undefined);
  const guild = { id: guest, name: "Test @everyone", ownerId: guest, memberCount: 12, leave: vi.fn(async () => undefined) };
  const client = { application: { fetch: vi.fn(async () => ({ owner: { id: owner } })) }, users: { fetch: vi.fn(async () => ({ send })) }, guilds: { cache: new Map([[guest, guild]]) } };
  const options = { enabled: true, allows: (id: string) => ids.includes(id), replace: (next: string[]) => { ids.splice(0, ids.length, ...next); }, activate, envPath, statePath };
  const manager = createPilotRequests(client as unknown as Client, options);
  const request = () => manager.request(guild as unknown as Guild);
  const button = (action: "approve" | "block", userId = owner) => {
    const payload = send.mock.calls[0] as unknown as [{ components: { components: { data: { custom_id: string } }[] }[] }];
    const interaction = { customId: payload[0].components[0]!.components[action === "approve" ? 0 : 1]!.data.custom_id, guildId: null,
      user: { id: userId }, message: { id: "message", edit: vi.fn(async () => undefined) },
      reply: vi.fn(async () => undefined), deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined) };
    return { interaction, handle: () => manager.handle(interaction as unknown as ButtonInteraction) };
  };
  return { manager, client, options, guild, request, button, send, ids, envPath, activate };
}
describe("private hosted pilot decisions", () => {
  it("keeps a new guild disabled and sends only one owner DM, including after restart", async () => {
    const f = await fixture(); await Promise.all([f.request(), f.request()]);
    expect(f.ids).not.toContain(guest); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.client.users.fetch).toHaveBeenCalledWith(owner);
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));
    await createPilotRequests(f.client as unknown as Client, f.options).request(f.guild as unknown as Guild);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.guild.leave).not.toHaveBeenCalled();
  });
  it("rejects non-owner clicks without changing approval or leaving", async () => {
    const f = await fixture(); await f.request(); const b = f.button("approve", guest); await b.handle();
    expect(b.interaction.reply).toHaveBeenCalled(); expect(f.ids).not.toContain(guest); expect(f.activate).not.toHaveBeenCalled();
  });
  it("persists approval, updates running admission, and activates exactly once on repeated clicks", async () => {
    const f = await fixture(); await f.request(); const b = f.button("approve"); await Promise.all([b.handle(), b.handle()]);
    expect(f.ids).toContain(guest); expect(pilotFilePolicy(await readFile(f.envPath, "utf8")).allows(guest)).toBe(true);
    expect(f.activate).toHaveBeenCalledTimes(1);
  });
  it("enforces capacity without consuming the pending request", async () => {
    const f = await fixture(1); await f.request(); const b = f.button("approve"); await b.handle();
    expect(b.interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("pilot is full"));
    expect(f.ids).not.toContain(guest); expect(f.activate).not.toHaveBeenCalled();
    await f.button("block").handle(); expect(f.guild.leave).toHaveBeenCalledTimes(1);
  });
  it("blocks persistently and suppresses reinvite notifications", async () => {
    const f = await fixture(); await f.request(); await f.button("block").handle();
    await createPilotRequests(f.client as unknown as Client, f.options).request(f.guild as unknown as Guild);
    expect(f.guild.leave).toHaveBeenCalledTimes(2); expect(f.send).toHaveBeenCalledTimes(1); expect(f.ids).not.toContain(guest);
  });
  it("rejects forged or stale request messages", async () => {
    const f = await fixture(); await f.request(); const b = f.button("approve"); b.interaction.message.id = "forged";
    await b.handle(); expect(f.ids).not.toContain(guest); expect(f.activate).not.toHaveBeenCalled();
  });
  it("welcomes the approved server's owner once, and a failed DM does not undo approval", async () => {
    const f = await fixture(); const welcome = vi.fn(async () => true);
    const manager = createPilotRequests(f.client as unknown as Client, { ...f.options, welcome });
    await manager.request(f.guild as unknown as Guild);
    const payload = f.send.mock.calls[0] as unknown as [{ components: { components: { data: { custom_id: string } }[] }[] }];
    const click = () => ({ customId: payload[0].components[0]!.components[0]!.data.custom_id, guildId: null, user: { id: owner },
      message: { id: "message", edit: vi.fn(async () => undefined) }, reply: vi.fn(async () => undefined),
      deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined) });
    const first = click(), second = click();
    await Promise.all([manager.handle(first as unknown as ButtonInteraction), manager.handle(second as unknown as ButtonInteraction)]);
    expect(welcome).toHaveBeenCalledTimes(1); expect(welcome).toHaveBeenCalledWith(f.guild);
    expect(first.editReply).toHaveBeenCalledWith(expect.stringContaining("welcome message"));

    const g = await fixture(); const failing = vi.fn(async () => { throw new Error("DMs closed"); });
    const other = createPilotRequests(g.client as unknown as Client, { ...g.options, welcome: failing });
    await other.request(g.guild as unknown as Guild);
    const b = g.button("approve"); await other.handle(b.interaction as unknown as ButtonInteraction);
    expect(g.ids).toContain(guest); expect(g.activate).toHaveBeenCalledTimes(1);
    expect(b.interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("Could not DM the server owner"));
  });
  it("builds a bilingual owner welcome that points at /setup start", async () => {
    const { approvalWelcome, welcomeApprovedOwner } = await import("../src/services/pilot-welcome.js");
    const text = approvalWelcome("My *Guild*").toJSON().description ?? "";
    expect(text).toContain("/setup start"); expect(text).toContain("approuvé"); expect(text).toContain("My \\*Guild\\*");
    const dm = vi.fn(async () => undefined);
    const client = { users: { fetch: vi.fn(async () => ({ bot: false, send: dm })) } };
    expect(await welcomeApprovedOwner(client as unknown as Client, { ownerId: guest, name: "G" } as unknown as Guild)).toBe(true);
    expect(client.users.fetch).toHaveBeenCalledWith(guest);
    dm.mockRejectedValueOnce(new Error("Cannot send messages to this user"));
    expect(await welcomeApprovedOwner(client as unknown as Client, { ownerId: guest, name: "G" } as unknown as Guild)).toBe(false);
  });
  it("retries a failed DM without granting access", async () => {
    const f = await fixture(); f.send.mockRejectedValueOnce(new Error("DM closed"));
    await expect(f.request()).rejects.toThrow("DM closed"); await f.request();
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.ids).not.toContain(guest);
  });
});
