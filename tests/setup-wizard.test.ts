import { beforeAll, describe, expect, it, vi } from "vitest";

const settings = {
  notifyChannelId: "c1", raidSignupChannelId: null, logChannelId: null, welcomeChannelId: null,
  applicantRoleId: null, memberRoleId: null, attendanceDkp: 10, lateAttendanceDkp: 5, bossKillDkp: 5,
  epCompletionBonus: 0, baseGp: 0, epgpDecayPercent: 0.1, raidReminderMinutes: 60, weeklyReportEnabled: false,
  timezone: "America/Toronto", language: "en", welcomeDelivery: "DM", welcomeRoleIds: ["r1"], welcomeRolePrompt: null
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
beforeAll(async () => {
  ({ renderStep } = await import("../src/commands/setup.js"));
}, 120_000);

describe("setup wizard screens", () => {
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
    expect(labels).toContain("Create missing channels (13)");
    expect(labels).toContain("Create missing roles (3)");
  });

  it("offers to post or repair the dungeon signup guide on the dungeon channels step", async () => {
    const screen = await renderStep(4, guild as never, "g1", "");
    const labels = screen.components.flatMap((row) => row.toJSON().components.map((c) => (c as { label?: string }).label));
    expect(labels).toContain("Post/repair signup guide");
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
