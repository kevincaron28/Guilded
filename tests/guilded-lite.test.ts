import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ButtonInteraction, Client, Guild } from "discord.js";
import { createPilotPolicy } from "../src/services/pilot-policy.js";
import { createPilotRequests } from "../src/services/pilot-requests.js";
import { allowsLite, commandSetFor, liteCommandJson, LITE_SETUP_STEPS } from "../src/commands/lite.js";
import { commands } from "../src/commands/index.js";

const primary = "111111111111111111", guest = "222222222222222222", owner = "333333333333333333", second = "444444444444444444";
type Option = { name: string; options?: Option[] };

describe("pilot tiers", () => {
  it("keeps allows() as full access and reports approved, lite or blocked", () => {
    const policy = createPilotPolicy({ enabled: true, primaryGuildId: primary, guildIds: "", limit: 5 });
    policy.liteIds.push(guest);
    expect(policy.tier(primary)).toBe("approved");
    expect(policy.tier(guest)).toBe("lite");
    expect(policy.allows(guest)).toBe(false);
    expect(policy.tier(second)).toBe("blocked");
  });
  it("treats every server as approved on an independent installation", () => {
    const policy = createPilotPolicy({ enabled: false, primaryGuildId: primary, guildIds: "", limit: 5 });
    expect(policy.tier(guest)).toBe("approved");
  });
});

describe("Lite command set", () => {
  const lite = liteCommandJson(commands) as unknown as Option[];
  const byName = new Map(lite.map((command) => [command.name, command]));
  const subs = (name: string) => (byName.get(name)?.options ?? []).map((option) => option.name).sort();

  it("registers only setup, help, FAQ, bug reports, dungeon groups and basic signups", () => {
    expect([...byName.keys()].sort()).toEqual(["dungeon", "help", "lead", "mod", "raid", "report", "setup"]);
    expect(subs("setup")).toEqual(["start"]);
    expect(subs("report")).toEqual(["bug", "ping"]);
    expect(subs("mod")).toEqual(["faq"]);
    expect(subs("dungeon")).toEqual(["group"]);
    expect(subs("raid")).toEqual(["cancel-signup", "roster", "signup", "status"]);
    expect(subs("lead")).toEqual(["cancel", "create", "edit"]);
    const create = byName.get("lead")!.options!.find((option) => option.name === "create")!;
    expect(create.options!.map((option) => option.name)).not.toContain("core");
    expect(create.options!.map((option) => option.name)).not.toContain("weekly");
    // FAQ keeps its own subcommands under /mod faq.
    expect(byName.get("mod")!.options![0]!.options!.length).toBeGreaterThan(1);
  });
  it("chooses the full list, the Lite list or nothing by tier", () => {
    expect(commandSetFor("approved", commands)).toHaveLength(commands.length);
    expect(commandSetFor("lite", commands)).toEqual(lite);
    expect(commandSetFor("blocked", commands)).toBeNull();
  });
  it("refuses other commands from a Lite server, including stale registrations", () => {
    expect(allowsLite("help", null, null)).toBe(true);
    expect(allowsLite("setup", null, "start")).toBe(true);
    expect(allowsLite("setup", null, "reset")).toBe(false);
    expect(allowsLite("mod", "faq", "add")).toBe(true);
    expect(allowsLite("mod", null, "kick")).toBe(false);
    expect(allowsLite("dungeon", null, "group")).toBe(true);
    expect(allowsLite("dungeon", null, "leaderboard")).toBe(false);
    expect(allowsLite("raid", null, "signup")).toBe(true);
    expect(allowsLite("lead", null, "create")).toBe(true);
    expect(allowsLite("lead", null, "award-ep")).toBe(false);
    expect(allowsLite("raid", null, "award-ep")).toBe(false);
    expect(allowsLite("epgp", null, "standings")).toBe(false);
  });
  it("limits the setup wizard to language, roles and channels before the checklist", () => {
    expect(LITE_SETUP_STEPS).toEqual([0, 1, 2, 3, 4, 8]);
  });
});

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(liteLimit = 1, clock = { at: Date.UTC(2026, 9, 18) }) {
  const dir = await mkdtemp(join(tmpdir(), "guilded-lite-")); dirs.push(dir);
  const envPath = join(dir, ".env.local"), statePath = join(dir, "requests.json");
  await writeFile(envPath, `DISCORD_GUILD_ID=${primary}\nDISCORD_CLIENT_ID=${primary}\nHOSTED_PILOT=true\nHOSTED_GUILD_LIMIT=5\n`);
  const policy = createPilotPolicy({ enabled: true, primaryGuildId: primary, guildIds: "", limit: 5 });
  const send = vi.fn(async () => ({ id: `message-${send.mock.calls.length}` })), activate = vi.fn(async () => undefined);
  const makeGuild = (id: string) => ({ id, name: `Guild ${id.slice(0, 3)}`, ownerId: id, memberCount: 3, leave: vi.fn(async () => undefined) });
  const guild = makeGuild(guest), other = makeGuild(second);
  const client = { application: { fetch: vi.fn(async () => ({ owner: { id: owner } })) }, users: { fetch: vi.fn(async () => ({ send })) },
    guilds: { cache: new Map([[guest, guild], [second, other]]) } };
  const warnIdle = vi.fn(async () => true);
  const options = { enabled: true, allows: policy.allows, liteLimit, envPath, statePath, activate, warnIdle, now: () => clock.at,
    replace: (ids: string[]) => { policy.guildIds.splice(0, policy.guildIds.length, ...ids); },
    replaceLite: (ids: string[]) => { policy.liteIds.splice(0, policy.liteIds.length, ...ids); } };
  const manager = createPilotRequests(client as unknown as Client, options);
  const click = (action: "approve" | "block", index = 0) => {
    const payload = send.mock.calls[index] as unknown as [{ components: { components: { data: { custom_id: string } }[] }[] }];
    const interaction = { customId: payload[0].components[0]!.components[action === "approve" ? 0 : 1]!.data.custom_id, guildId: null,
      user: { id: owner }, message: { id: `message-${index + 1}`, edit: vi.fn(async () => undefined) },
      reply: vi.fn(async () => undefined), deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined) };
    return manager.handle(interaction as unknown as ButtonInteraction).then(() => interaction);
  };
  return { manager, client, options, policy, guild, other, send, activate, click, statePath, warnIdle, clock };
}

describe("automatic Lite admission", () => {
  it("admits a new server to Lite before the owner decides, and tells the owner", async () => {
    const f = await fixture();
    await f.manager.request(f.guild as unknown as Guild);
    expect(f.policy.tier(guest)).toBe("lite");
    expect(f.policy.allows(guest)).toBe(false);
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Lite access granted automatically") }));
    expect(JSON.parse(await readFile(f.statePath, "utf8"))[guest].status).toBe("lite");
  });
  it("keeps Lite when the owner DM fails, and restores it after a restart", async () => {
    const f = await fixture(); f.send.mockRejectedValueOnce(new Error("DM closed"));
    await expect(f.manager.request(f.guild as unknown as Guild)).rejects.toThrow("DM closed");
    expect(f.policy.tier(guest)).toBe("lite");
    f.policy.liteIds.splice(0);
    await createPilotRequests(f.client as unknown as Client, f.options).restore();
    expect(f.policy.tier(guest)).toBe("lite");
  });
  it("leaves servers past the Lite cap waiting with no access, and frees a slot when one leaves", async () => {
    const f = await fixture(1);
    await f.manager.request(f.guild as unknown as Guild);
    await f.manager.request(f.other as unknown as Guild);
    expect(f.policy.tier(second)).toBe("blocked");
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining("Lite slots full") }));
    await f.manager.forget(guest);
    expect(f.policy.tier(guest)).toBe("blocked");
    expect(JSON.parse(await readFile(f.statePath, "utf8"))[guest]).toBeUndefined();
  });
  it("gives no Lite when the cap is 0, as before", async () => {
    const f = await fixture(0);
    await f.manager.request(f.guild as unknown as Guild);
    expect(f.policy.tier(guest)).toBe("blocked");
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("No access until you approve") }));
  });
  it("upgrades a Lite server to full access on approval and re-registers every command", async () => {
    const f = await fixture();
    await f.manager.request(f.guild as unknown as Guild);
    await f.click("approve");
    expect(f.policy.tier(guest)).toBe("approved");
    expect(f.policy.liteIds).not.toContain(guest);
    expect(f.activate).toHaveBeenCalledWith(f.guild);
  });
  it("blocks a Lite server: it loses Lite, the bot leaves, and a rejoin is refused", async () => {
    const f = await fixture();
    await f.manager.request(f.guild as unknown as Guild);
    await f.click("block");
    expect(f.policy.tier(guest)).toBe("blocked");
    expect(f.guild.leave).toHaveBeenCalledTimes(1);
    await f.manager.forget(guest); // GuildDelete after leaving keeps the block.
    await f.manager.request(f.guild as unknown as Guild);
    expect(f.guild.leave).toHaveBeenCalledTimes(2);
    expect(f.policy.tier(guest)).toBe("blocked");
  });
});

describe("idle Lite servers", () => {
  const DAY = 24 * 60 * 60 * 1000;
  it("warns after 30 idle days and leaves 7 days later, freeing the slot", async () => {
    const f = await fixture();
    await f.manager.request(f.guild as unknown as Guild);
    f.clock.at += 29 * DAY; await f.manager.sweepIdle();
    expect(f.warnIdle).not.toHaveBeenCalled();
    f.clock.at += 1 * DAY; await f.manager.sweepIdle(); await f.manager.sweepIdle();
    expect(f.warnIdle).toHaveBeenCalledTimes(1);
    expect(f.guild.leave).not.toHaveBeenCalled();
    f.clock.at += 7 * DAY; await f.manager.sweepIdle();
    expect(f.guild.leave).toHaveBeenCalledTimes(1);
    expect(f.policy.tier(guest)).toBe("blocked");
    expect(JSON.parse(await readFile(f.statePath, "utf8"))[guest]).toBeUndefined();
  });
  it("cancels the warning when someone uses a command", async () => {
    const f = await fixture();
    await f.manager.request(f.guild as unknown as Guild);
    f.clock.at += 30 * DAY; await f.manager.sweepIdle();
    expect(f.warnIdle).toHaveBeenCalledTimes(1);
    f.clock.at += 3 * DAY; await f.manager.touch(guest);
    f.clock.at += 5 * DAY; await f.manager.sweepIdle();
    expect(f.guild.leave).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(f.statePath, "utf8"))[guest].warnedAt).toBeUndefined();
  });
  it("never sweeps approved or waiting-without-Lite servers, and starts old entries' 30 days now", async () => {
    const f = await fixture(0);
    await f.manager.request(f.guild as unknown as Guild);
    f.clock.at += 60 * DAY; await f.manager.sweepIdle();
    expect(f.warnIdle).not.toHaveBeenCalled(); expect(f.guild.leave).not.toHaveBeenCalled();
    const g = await fixture();
    await writeFile(g.statePath, JSON.stringify({ [guest]: { nonce: "n", name: "Old", status: "lite", messageId: "m" } }));
    await g.manager.sweepIdle();
    expect(JSON.parse(await readFile(g.statePath, "utf8"))[guest].activeAt).toBe(g.clock.at);
    expect(g.warnIdle).not.toHaveBeenCalled();
  });
});
