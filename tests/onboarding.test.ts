import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  memberOnboarding: { findUnique: vi.fn(), upsert: vi.fn() },
  character: { count: vi.fn() }
}));
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/services/character-pairing.js", () => ({
  issueCharacterPairingCode: vi.fn().mockResolvedValue({ code: "ABCD-1234", expiresAt: new Date("2026-10-02T12:00:00Z") })
}));

import {
  checklistText, handleOnboardingInteraction, onboardingGuildService, onboardingIncomplete, runOnboardingNudges, welcomePanel
} from "../src/services/onboarding.js";
import { handleMemberJoin, welcomeGuildService } from "../src/services/housekeeping.js";

const HOUR = 60 * 60 * 1000;
const role = (id: string, name: string, permissions = 0n, managed = false) => ({ id, name, managed, permissions: { bitfield: permissions } });
const baseSettings = {
  language: "en", welcomeRoleIds: ["wow", "poe"], welcomeRolePrompt: null, rulesChannelId: "rules", rulesGate: true,
  applicantRoleId: "applicant", memberRoleId: "member", onboardingNudge: true, welcomeDelivery: "CHANNEL", welcomeChannelId: null, welcomeMessageTemplate: null
};

function fakeMember(held: string[] = [], extra: Record<string, unknown> = {}) {
  const has = new Set(held);
  return {
    id: "u1", user: { id: "u1", username: "Kev", bot: false },
    roles: {
      cache: { has: (id: string) => has.has(id) },
      add: vi.fn(async (target: string | { id: string }) => { has.add(typeof target === "string" ? target : target.id); }),
      remove: vi.fn(async (target: { id: string }) => { has.delete(target.id); })
    },
    send: vi.fn().mockResolvedValue(undefined),
    ...extra
  };
}

function fakeGuild(member: ReturnType<typeof fakeMember>, roles = [role("wow", "World of Warcraft"), role("poe", "Path of Exile 2")]) {
  const guild = {
    id: "g1", name: "Quebec Gold", memberCount: 1,
    roles: { cache: new Map(roles.map((entry) => [entry.id, entry])) },
    members: { fetch: vi.fn().mockResolvedValue(member), cache: new Map([[member.id, member]]) }
  };
  (member as unknown as { guild: unknown }).guild = guild;
  return guild;
}

function click(customId: string, guild: ReturnType<typeof fakeGuild>, values?: string[]) {
  return {
    customId, guild, user: { id: "u1" }, client: { guilds: { fetch: vi.fn().mockResolvedValue(guild) } },
    values: values ?? [], isStringSelectMenu: () => values !== undefined,
    reply: vi.fn(), update: vi.fn()
  };
}

const customIds = (payload: { components: { toJSON(): unknown }[] }) =>
  (payload.components[0]!.toJSON() as { components: { custom_id: string }[] }).components.map((component) => component.custom_id);

function useSettings(settings: Record<string, unknown>) {
  for (const service of [onboardingGuildService, welcomeGuildService]) {
    vi.spyOn(service, "ensureGuild").mockResolvedValue({ id: "db-g1" } as never);
    vi.spyOn(service, "getSettings").mockResolvedValue(settings as never);
    vi.spyOn(service, "ensureMember").mockResolvedValue({ id: "m1" } as never);
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  db.memberOnboarding.findUnique.mockReset().mockResolvedValue(null);
  db.memberOnboarding.upsert.mockReset().mockResolvedValue({});
  db.character.count.mockReset().mockResolvedValue(0);
});

describe("onboarding checklist", () => {
  it("is incomplete while the rules or the games are open", () => {
    expect(onboardingIncomplete({ rules: false, games: true, character: true })).toBe(true);
    expect(onboardingIncomplete({ rules: true, games: false, character: true })).toBe(true);
    expect(onboardingIncomplete({ rules: true, games: true, character: false })).toBe(false);
  });

  it("requires a character only in a server with no game roles", () => {
    expect(onboardingIncomplete({ rules: null, games: null, character: false })).toBe(true);
    expect(onboardingIncomplete({ rules: null, games: null, character: true })).toBe(false);
  });

  it("lists only the steps the server uses", () => {
    const text = checklistText({ rules: true, games: false, character: false }, "fr", "Quebec Gold");
    expect(text).toContain("✅ Lire et accepter les règles");
    expect(text).toContain("⬜ Choisir tes jeux");
    expect(text).toContain("seulement si tu joues à WoW");
    expect(checklistText({ rules: null, games: null, character: true }, "en", "QG")).not.toContain("rules");
  });

  it("builds a panel that names the rules channel", () => {
    const panel = welcomePanel({ welcomeRoleIds: ["wow"], rulesChannelId: "rules" }, { id: "g1", name: "QG" }, "fr");
    expect(panel.embeds[0]!.data.title).toBe("👋 Commence ici");
    expect(panel.embeds[0]!.data.description).toContain("<#rules>");
    expect(customIds(panel)).toEqual(["onboard:rules:g1", "onboard:games:g1", "onboard:pair:g1", "onboard:steps:g1"]);
  });
});

describe("rules gate", () => {
  it("holds the applicant role back on join", async () => {
    const member = fakeMember();
    useSettings(baseSettings);
    await handleMemberJoin(fakeGuild(member) as never, member as never);
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it("gives the applicant role on join when the gate is off", async () => {
    const member = fakeMember();
    useSettings({ ...baseSettings, rulesGate: false });
    await handleMemberJoin(fakeGuild(member) as never, member as never);
    expect(member.roles.add).toHaveBeenCalledWith("applicant");
  });

  it("asks for the rules before the game menu or a pairing code", async () => {
    const member = fakeMember();
    const guild = fakeGuild(member);
    useSettings(baseSettings);
    for (const action of ["games", "pair"]) {
      const interaction = click(`onboard:${action}:g1`, guild);
      await handleOnboardingInteraction(interaction as never);
      const payload = interaction.reply.mock.calls[0]![0];
      expect(payload.content).toContain("<#rules>");
      expect(customIds(payload)).toEqual(["onboard:accept:g1"]);
    }
    const pick = click("onboard:pick:g1", guild, ["wow"]);
    await handleOnboardingInteraction(pick as never);
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it("records the acceptance and gives the applicant role then", async () => {
    const member = fakeMember();
    const guild = fakeGuild(member);
    useSettings(baseSettings);
    const interaction = click("onboard:accept:g1", guild);
    await handleOnboardingInteraction(interaction as never);
    expect(db.memberOnboarding.upsert).toHaveBeenCalledTimes(1);
    expect(member.roles.add).toHaveBeenCalledWith("applicant", "Rules accepted");
    expect(interaction.reply.mock.calls[0]![0].content).toContain("✅ Read and accept the rules");
  });

  it("does not turn a guild member back into an applicant", async () => {
    const member = fakeMember(["member"]);
    useSettings(baseSettings);
    await handleOnboardingInteraction(click("onboard:accept:g1", fakeGuild(member)) as never);
    expect(member.roles.add).not.toHaveBeenCalled();
  });
});

describe("game menu and pairing", () => {
  const accepted = () => db.memberOnboarding.findUnique.mockResolvedValue({ rulesAcceptedAt: new Date() });

  it("offers only harmless roles, with the held ones ticked", async () => {
    accepted();
    const member = fakeMember(["poe"]);
    const guild = fakeGuild(member, [role("wow", "World of Warcraft"), role("poe", "Path of Exile 2"), role("admin", "Admin", 8n)]);
    useSettings({ ...baseSettings, welcomeRoleIds: ["wow", "poe", "admin", "gone"] });
    const interaction = click("onboard:games:g1", guild);
    await handleOnboardingInteraction(interaction as never);
    const menu = interaction.reply.mock.calls[0]![0].components[0].toJSON().components[0];
    expect(menu.options.map((option: { value: string; default?: boolean }) => [option.value, !!option.default])).toEqual([["wow", false], ["poe", true]]);
  });

  it("adds the ticked roles and removes the unticked ones", async () => {
    accepted();
    const member = fakeMember(["poe"]);
    const guild = fakeGuild(member);
    useSettings(baseSettings);
    const interaction = click("onboard:pick:g1", guild, ["wow", "admin"]);
    await handleOnboardingInteraction(interaction as never);
    expect(member.roles.add.mock.calls.map((call) => (call[0] as { id: string }).id)).toEqual(["wow"]);
    expect(member.roles.remove.mock.calls.map((call) => (call[0] as { id: string }).id)).toEqual(["poe"]);
    expect(interaction.update.mock.calls[0]![0].content).toContain("**World of Warcraft**");
  });

  it("gives a pairing code privately", async () => {
    accepted();
    const member = fakeMember();
    useSettings(baseSettings);
    const interaction = click("onboard:pair:g1", fakeGuild(member));
    await handleOnboardingInteraction(interaction as never);
    const payload = interaction.reply.mock.calls[0]![0];
    expect(payload.content).toContain("**ABCD-1234**");
    expect(payload.ephemeral).toBe(true);
  });
});

describe("reminder", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const joined = (hoursAgo: number, extra: Record<string, unknown> = {}) => {
    const member = fakeMember([], { joinedTimestamp: now.getTime() - hoursAgo * HOUR, ...extra });
    return { member, client: { guilds: { cache: new Map([["g1", fakeGuild(member)]]) } } };
  };

  it("reminds once, a day after joining, and marks it before sending", async () => {
    const { member, client } = joined(30);
    useSettings(baseSettings);
    member.send.mockImplementation(async () => { expect(db.memberOnboarding.upsert).toHaveBeenCalledTimes(1); });
    expect(await runOnboardingNudges(client as never, now)).toBe(1);
    expect(customIds(member.send.mock.calls[0]![0])).toContain("onboard:rules:g1");
    db.memberOnboarding.findUnique.mockResolvedValue({ nudgedAt: now });
    expect(await runOnboardingNudges(client as never, now)).toBe(0);
  });

  it("leaves alone the too recent, the long-time members, the finished and the servers with it off", async () => {
    useSettings(baseSettings);
    for (const hours of [2, 200]) {
      const { member, client } = joined(hours);
      expect(await runOnboardingNudges(client as never, now)).toBe(0);
      expect(member.send).not.toHaveBeenCalled();
    }
    const done = joined(30);
    done.member.roles.cache.has = (id: string) => id === "wow";
    db.memberOnboarding.findUnique.mockResolvedValue({ rulesAcceptedAt: now });
    expect(await runOnboardingNudges(done.client as never, now)).toBe(0);
    db.memberOnboarding.findUnique.mockResolvedValue(null);
    useSettings({ ...baseSettings, onboardingNudge: false });
    expect(await runOnboardingNudges(joined(30).client as never, now)).toBe(0);
  });
});
