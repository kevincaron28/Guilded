import { beforeAll, describe, expect, it, vi } from "vitest";
import { guildService, requireGuildContext } from "../src/commands/context.js";

const settings = {
  notifyChannelId: "c1", raidSignupChannelId: null, logChannelId: null, welcomeChannelId: null,
  applicantRoleId: null, memberRoleId: null, attendanceDkp: 10, lateAttendanceDkp: 5, bossKillDkp: 5,
  epCompletionBonus: 0, baseGp: 0, epgpDecayPercent: 0.1, raidReminderMinutes: 60, weeklyReportEnabled: false,
  timezone: "America/Toronto", language: "en", welcomeDelivery: "DM", welcomeRoleIds: ["r1"], welcomeRolePrompt: null,
  rulesGate: false, rulesChannelId: null as string | null,
  publicDungeonRuns: false, publicDungeonRunsSince: null as Date | null
};
vi.mock("../src/commands/context.js", () => ({
  guildService: { getSettings: vi.fn(async () => settings), updateSettings: vi.fn() },
  requireGuildContext: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: { character: { count: vi.fn(async () => 0) }, companionCredential: { count: vi.fn(async () => 0) } } }));

const roles = [{ id: "r1", name: "Officer", comparePositionTo: () => -1 }];
const rolesCache = {
  some: (fn: (r: unknown) => boolean) => roles.some(fn),
  map: (fn: (r: { name: string }) => string) => roles.map(fn),
  filter: (fn: (r: unknown) => boolean) => roles.filter(fn),
  find: (fn: (r: unknown) => boolean) => roles.find(fn),
  get: (id: string) => roles.find((r) => r.id === id)
};
const guild = {
  roles: { fetch: vi.fn(), cache: rolesCache, everyone: { id: "everyone" } },
  channels: { fetch: vi.fn(async () => ({ name: "announcements", permissionsFor: () => ({ has: () => true }) })) },
  members: { me: { id: "bot", permissions: { has: () => true }, roles: { highest: { comparePositionTo: () => 1 } } } }
};

// Loading the command module (discord.js builders) can take a few seconds
// on a busy machine; do it once, with room, so no single test times out.
let renderStep: typeof import("../src/commands/setup.js").renderStep;
let executeSetup: typeof import("../src/commands/setup.js").executeSetup;
beforeAll(async () => {
  ({ renderStep, executeSetup } = await import("../src/commands/setup.js"));
}, 120_000);

describe("setup wizard screens", () => {
  it("shows the public audience, cutoff and opt-out on the welcome screen and checklist in both languages", async () => {
    settings.publicDungeonRuns = true;
    settings.publicDungeonRunsSince = new Date("2026-11-10T12:00:00Z");
    try {
      for (const language of ["en", "fr"]) {
        settings.language = language;
        for (const step of [0, 8]) {
          const screen = await renderStep(step, guild as never, "g1", "");
          const description = screen.embeds[0]!.toJSON().description!;
          expect(description).toContain("https://guilded.kcaron.top/leaderboards/");
          expect(description).toContain("/mod leaderboard share:false");
          expect(description).toContain("<t:1794312000:f>");
          expect(description).toContain(language === "fr" ? "hors guilde" : "non-guild players");
          expect(description).toContain(language === "fr" ? "anciens imports restent privés" : "older imports stay private");
          const off = screen.components.flatMap(row => row.toJSON().components).find(c => "custom_id" in c && c.custom_id === "setup:public-sharing-off");
          expect(off).toMatchObject({ disabled: false });
        }
      }
      settings.publicDungeonRuns = false;
      const screen = await renderStep(0, guild as never, "g1", "");
      expect(screen.embeds[0]!.toJSON().description).toContain("DÉSACTIVÉ");
      expect(screen.components.flatMap(row => row.toJSON().components).find(c => "custom_id" in c && c.custom_id === "setup:public-sharing-off")).toMatchObject({ disabled: true });
    } finally {
      settings.language = "en";
      settings.publicDungeonRuns = false;
      settings.publicDungeonRunsSince = null;
    }
  });

  it("saves an opt-out when the setup button is clicked and redraws the private state", async () => {
    settings.publicDungeonRuns = true;
    const listeners = new Map<string, (...args: never[]) => void>();
    const collector = { on: (event: string, handler: (...args: never[]) => void) => listeners.set(event, handler) };
    vi.mocked(requireGuildContext).mockResolvedValue({ guildId: "g1", memberId: "m1" } as never);
    vi.mocked(guildService.updateSettings).mockImplementation((_id, data) => {
      settings.publicDungeonRuns = data.publicDungeonRuns!;
      return Promise.resolve(settings) as never;
    });
    const editReply = vi.fn<(payload: { embeds: { data: { description: string } }[] }) => Promise<void>>(async () => undefined);
    try {
      await executeSetup({ guild, guildId: "discord", user: { id: "owner" }, member: { permissions: { has: () => true } },
        options: { getBoolean: () => false }, deferReply: vi.fn(), editReply,
        fetchReply: async () => ({ createMessageComponentCollector: () => collector }) } as never);
      listeners.get("collect")!({ customId: "setup:public-sharing-off", user: { id: "owner" }, deferUpdate: async () => undefined,
        isChannelSelectMenu: () => false, isRoleSelectMenu: () => false, isStringSelectMenu: () => false } as never);
      await vi.waitFor(() => expect(editReply).toHaveBeenCalledTimes(2));
      expect(guildService.updateSettings).toHaveBeenCalledWith("g1", { publicDungeonRuns: false });
      expect(editReply.mock.calls[1]![0].embeds[0]!.data.description).toContain("sharing: OFF");
    } finally {
      settings.publicDungeonRuns = false;
      vi.mocked(guildService.updateSettings).mockReset();
      vi.mocked(requireGuildContext).mockReset();
    }
  });

  it("every step builds a payload Discord will accept", async () => {
    for (let step = 0; step <= 8; step++) {
      const screen = await renderStep(step, guild as never, "g1", step === 2 ? "Saved <#c1>." : "");
      expect(screen.components.length).toBeLessThanOrEqual(5);
      const ids = new Set<string>();
      for (const row of screen.components) {
        const json = row.toJSON();
        expect(json.components.length).toBeGreaterThan(0);
        expect(json.components.length).toBeLessThanOrEqual(5);
        for (const component of json.components) {
          const id = (component as { custom_id?: string }).custom_id ?? "";
          expect(id.length).toBeLessThanOrEqual(100);
          expect(ids.has(id)).toBe(false);
          ids.add(id);
        }
      }
      const embed = screen.embeds[0]!.toJSON();
      expect((embed.description ?? "").length).toBeLessThanOrEqual(4096);
      expect(embed.title).toContain("Guilded setup");
    }
  });

  it("step 1 offers to create exactly the missing required roles", async () => {
    const screen = await renderStep(1, guild as never, "g1", "");
    const labels = screen.components.flatMap((row) => row.toJSON().components.map((c) => (c as { label?: string }).label));
    expect(labels).toContain("Create missing roles (3)");
  });

  it("the checklist step lists what's missing with a fix", async () => {
    const text = (await renderStep(8, guild as never, "g1", "")).embeds[0]!.toJSON().description ?? "";
    expect(text).toContain("❌ Raid signups channel");
    expect(text).toContain("Press \"Create missing channels\" on this checklist");
    expect(text).toContain("✅ Announcements channel (#announcements)");
  });

  it("the checklist step offers to create every missing channel and role in one click", async () => {
    const screen = await renderStep(8, guild as never, "g1", "");
    const labels = screen.components.flatMap((row) => row.toJSON().components.map((c) => (c as { label?: string }).label));
    expect(labels).toContain("Create missing channels (12)");
    expect(labels).toContain("Create missing roles (3)");
  });

  it("offers to post or repair the dungeon signup guide on the dungeon channels step", async () => {
    const screen = await renderStep(4, guild as never, "g1", "");
    const labels = screen.components.flatMap((row) => row.toJSON().components.map((c) => (c as { label?: string }).label));
    expect(labels).toContain("Post/repair signup guide");
  });

  it("explains that WoW setup is for WoW players and that the Windows app is optional", async () => {
    const text = (await renderStep(8, guild as never, "g1", "")).embeds[0]!.data.description!;
    expect(text).toContain("WoW linking is only for WoW players");
    expect(text).toContain("Character linking and the companion are optional");
  });

  it("explains the actual applicant-role timing when rules are required", async () => {
    settings.rulesGate = true;
    settings.rulesChannelId = "rules";
    try {
      const text = (await renderStep(6, guild as never, "g1", "")).embeds[0]!.data.description!;
      expect(text).toContain("given after accepting the rules");
      expect(text).not.toContain("given automatically when someone joins");
      settings.language = "fr";
      const french = (await renderStep(6, guild as never, "g1", "")).embeds[0]!.data.description!;
      expect(french).toContain("après l'acceptation des règles");
    } finally {
      settings.rulesGate = false;
      settings.rulesChannelId = null;
      settings.language = "en";
    }
  });
});

describe("setup wizard in French", () => {
  it("every step is French, within Discord's limits, and the language picker is on the first screen", async () => {
    settings.language = "fr";
    try {
      for (let step = 0; step <= 8; step++) {
        const screen = await renderStep(step, guild as never, "g1", "");
        const embed = screen.embeds[0]!.toJSON();
        expect((embed.description ?? "").length).toBeLessThanOrEqual(4096);
        expect(embed.title).toContain("Configuration de Guilded");
        for (const row of screen.components) {
          for (const component of row.toJSON().components) {
            const c = component as { label?: string; placeholder?: string; options?: { label: string }[] };
            expect((c.label ?? "").length).toBeLessThanOrEqual(80);
            expect((c.placeholder ?? "").length).toBeLessThanOrEqual(150);
            for (const option of c.options ?? []) expect(option.label.length).toBeLessThanOrEqual(100);
          }
        }
      }
      const first = await renderStep(0, guild as never, "g1", "");
      const labels = first.components.flatMap((row) => row.toJSON().components.map((c) => (c as { label?: string }).label));
      expect(labels).toEqual(expect.arrayContaining(["English", "Français", "Commencer ▶"]));
      const roles = (await renderStep(1, guild as never, "g1", "")).embeds[0]!.toJSON().description ?? "";
      expect(roles).toContain("Maître de guilde");
      expect(roles).toContain("(facultatif)");
      const checklist = (await renderStep(8, guild as never, "g1", "")).embeds[0]!.toJSON().description ?? "";
      expect(checklist).toContain("❌ Salon des inscriptions aux raids");
      expect(checklist).toContain("Appuyez sur « Créer les salons manquants »");
    } finally {
      settings.language = "en";
    }
  });

  it("in English the first screen also offers the language buttons", async () => {
    const first = await renderStep(0, guild as never, "g1", "");
    const labels = first.components.flatMap((row) => row.toJSON().components.map((c) => (c as { label?: string }).label));
    expect(labels).toEqual(expect.arrayContaining(["English", "Français", "Start ▶"]));
  });
});
