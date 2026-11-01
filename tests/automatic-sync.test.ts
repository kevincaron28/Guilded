import { describe, expect, it, vi } from "vitest";
import { createProfileEngine, planProfiles } from "../companion/profile-engine.mjs";
import { switchProfile } from "../companion/profiles.mjs";
import { issueMemberCredential } from "../src/services/character-pairing.js";
import { issuePersonalCredential, prismaPersonalStore } from "../src/services/personal-pairing.js";
import { prismaDeviceStore } from "../src/services/companion-devices.js";

const guild = (name: string) => ({ uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: name, wowGuildId: name, wowGuild: name, companionCredential: `credential-${name}`, watchFile: `/games/${name}/WTF/Account/A/SavedVariables/Guilded.lua`, syncEnabled: true });

describe("enabled profile synchronization", () => {
  it("retains enabled connections across selection and leaves unapproved legacy profiles stopped", () => {
    const config = { ...guild("a"), activeProfile: "a", profiles: { b: guild("b"), old: { ...guild("old"), syncEnabled: undefined } } };
    const plans = planProfiles(switchProfile(config, "b"));
    expect(plans.filter(p => p.enabled).map(p => p.id).sort()).toEqual(["a", "b"]);
    expect(plans.find(p => p.id === "old")?.enabled).toBe(false);
  });
  it("hands a shared output folder to the selected profile, while allowing both uploads", () => {
    const a = guild("a"), b = { ...guild("b"), watchFile: a.watchFile };
    const config = { ...a, activeProfile: "a", profiles: { b } };
    const plans = planProfiles(config);
    expect(plans.every(p => p.enabled && !p.error)).toBe(true);
    expect(plans.map(p => [p.id, p.config.writeStandingsEnabled])).toEqual([["a", true], ["b", false]]);
    expect(planProfiles(switchProfile(config, "b")).map(p => [p.id, p.config.writeStandingsEnabled])).toEqual([["b", true], ["a", false]]);
  });
  it("blocks ambiguous shared-file routing instead of sending another guild's data", () => {
    const a = { ...guild("a"), wowGuild: "" }, b = { ...guild("b"), watchFile: a.watchFile };
    expect(planProfiles({ ...a, activeProfile: "a", profiles: { b } }).every(p => !!p.error)).toBe(true);
  });
  it("does not treat older credentials for one Discord server as one WoW guild", () => {
    const a = { ...guild("a"), guildDiscordId: "shared", wowGuildId: undefined, wowGuild: "" };
    const b = { ...a, companionCredential: "different-credential" };
    expect(planProfiles({ ...a, activeProfile: "a", profiles: { b } }).every(p => !!p.error)).toBe(true);
    const routed = { ...a, wowGuild: "Alpha-Realm" };
    expect(planProfiles({ ...routed, activeProfile: "a", profiles: { b: { ...b, wowGuild: "Beta-Realm" } } }).every(p => !p.error && p.config.requireWowGuild)).toBe(true);
  });
  it("also reserves the companion data addon when custom standings files differ", () => {
    const a = { ...guild("a"), standingsFile: "/game/AddOns/Guilded/first.lua" };
    const b = { ...guild("b"), standingsFile: "/game/AddOns/Guilded/second.lua" };
    expect(planProfiles({ ...a, activeProfile: "a", profiles: { b } }).map(p => p.writesStandings)).toEqual([true, false]);
  });
  it("drains old engines before reconfiguration and resumes enabled profiles after sleep", async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    let delayed = false;
    const factory = (config: { guildDiscordId: string }) => {
      let running = false;
      const id = config.guildDiscordId;
      return { state: () => ({ running }), start: async () => { running = true; events.push(`start:${id}`); return true; }, stop: async () => { events.push(`stop:${id}`); if (delayed && id === "a") await new Promise<void>(resolve => { release = resolve; }); running = false; }, uploadNow: vi.fn(), refreshStandings: vi.fn() };
    };
    const config = { ...guild("a"), activeProfile: "a", profiles: { b: guild("b") } };
    const manager = createProfileEngine(config, {}, factory as never);
    await manager.start();
    expect(manager.state().profiles.filter((p: { running: boolean }) => p.running)).toHaveLength(2);
    delayed = true;
    const switching = manager.configure(switchProfile(config, "b"));
    await vi.waitFor(() => expect(events).toContain("stop:a"));
    expect(events.filter(e => e.startsWith("start"))).toHaveLength(2);
    delayed = false; release(); await switching;
    expect(manager.state().profiles.filter((p: { running: boolean }) => p.running)).toHaveLength(2);
    await manager.suspend(); await manager.resume();
    expect(manager.state().profiles.filter((p: { running: boolean }) => p.running)).toHaveLength(2);
    await manager.stop(); const count = events.length; await manager.resume();
    expect(events).toHaveLength(count);
  });
  it("a broken profile does not stop another profile", async () => {
    const config = { ...guild("a"), activeProfile: "a", profiles: { b: guild("b") } };
    const manager = createProfileEngine(config, {}, ((p: { guildDiscordId: string }) => ({ start: async () => { if (p.guildDiscordId === "a") throw new Error("Missing folder"); return true; }, stop: async () => {}, state: () => ({ running: true }) })) as never);
    await manager.start();
    expect(manager.state().profiles.find((p: { id: string }) => p.id === "a")?.error).toBe("Missing folder");
    expect(manager.state().profiles.find((p: { id: string }) => p.id === "b")?.running).toBe(true);
    await manager.stop();
  });
  it("retries an unavailable startup folder without restarting healthy connections", async () => {
    vi.useFakeTimers();
    let ready = false;
    const starts: string[] = [];
    const factory = (p: { guildDiscordId: string }) => {
      let running = false;
      return { start: async () => { starts.push(p.guildDiscordId); running = p.guildDiscordId === "b" || ready; return running; }, stop: async () => { running = false; }, state: () => ({ running }) };
    };
    const manager = createProfileEngine({ ...guild("a"), activeProfile: "a", profiles: { b: guild("b") } }, {}, factory as never);
    try {
      await manager.start(); ready = true;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(starts).toEqual(["a", "b", "a"]);
      expect(manager.state().profiles.every((p: { running: boolean }) => p.running)).toBe(true);
    } finally { await manager.stop(); vi.useRealTimers(); }
  });
});

describe("independent companion devices", () => {
  it("issues two distinct guild credentials without revoking either", async () => {
    const create = vi.fn(async () => ({})), updateMany = vi.fn();
    const database = { $transaction: async (fn: (tx: unknown) => unknown) => fn({ companionCredential: { create, updateMany } }) };
    const first = await issueMemberCredential(database as never, "member", "Home PC");
    const second = await issueMemberCredential(database as never, "member", "Laptop");
    expect(first).not.toBe(second); expect(updateMany).not.toHaveBeenCalled();
    expect(create.mock.calls.map(call => (call as unknown as [{ data: { deviceName: string } }])[0].data.deviceName)).toEqual(["Home PC", "Laptop"]);
  });
  it("personal sign-in preserves other devices too", async () => {
    const create = vi.fn(async () => ({})), updateMany = vi.fn();
    const store = prismaPersonalStore({ webCompanionCredential: { create, updateMany } } as never);
    await issuePersonalCredential(store, "account", "Browser");
    await issuePersonalCredential(store, "account", "Laptop");
    expect(create).toHaveBeenCalledTimes(2); expect(updateMany).not.toHaveBeenCalled();
  });
  it("scopes single-device and all-device revocation to the signed-in owner", async () => {
    const guild = vi.fn(async () => ({})), personal = vi.fn(async () => ({}));
    const store = prismaDeviceStore({ companionCredential: { updateMany: guild }, webCompanionCredential: { updateMany: personal } } as never);
    const account = { id: "account", discordUserId: "discord", username: "user", displayName: null };
    await store.change(account, "revoke", "guild", "guessed-other-device", "");
    expect(guild).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "guessed-other-device", revokedAt: null, member: { discordUserId: "discord" } } }));
    expect(personal).not.toHaveBeenCalled();
    await store.change(account, "revoke-all", "", "", "");
    expect(personal).toHaveBeenLastCalledWith(expect.objectContaining({ where: { revokedAt: null, accountId: "account" } }));
  });
});
