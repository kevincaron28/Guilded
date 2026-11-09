import { describe, expect, it, vi } from "vitest";
import { formatRankRolePreview, previewRankRoles } from "../src/services/rank-roles.js";

// 9.1 (docs/JEEVES_COMPARISON.md idea 2): who would get each rank role, before anything is saved.
const now = new Date("2026-11-09T12:00:00Z");
const fresh = new Date("2026-11-08T12:00:00Z");

function setup(opts: { enabled?: boolean; people?: { id: string; name: string; rank: number; roles?: string[] }[] } = {}) {
  const people = opts.people ?? [
    { id: "u1", name: "Alice", rank: 1 },
    { id: "u2", name: "Bob", rank: 1 },
    { id: "u3", name: "Cara", rank: 4, roles: ["officer"] }
  ];
  const add = vi.fn();
  const members = new Map(people.map((person) => [person.id, { displayName: person.name, roles: { cache: new Map((person.roles ?? []).map((id) => [id, {}])), add, remove: vi.fn() } }]));
  const prisma = {
    guild: { findUnique: vi.fn(async () => ({ id: "g1", settings: opts.enabled === undefined ? null : { rankRolesEnabled: opts.enabled } })) },
    guildRankRole: { findMany: vi.fn(async () => { throw new Error("the preview must use the proposed mapping"); }) },
    member: { findMany: vi.fn(async () => people.map((person) => ({ discordUserId: person.id, characters: [{ isMain: true, guildRankIndex: person.rank, guildRankAt: fresh }] }))) }
  };
  const guild = { id: "d1", roles: { cache: { get: (id: string) => ({ id, name: id, editable: true }) } }, members: { cache: members, fetch: vi.fn() } };
  return { prisma, guild, add };
}

describe("rank roles preview", () => {
  it("counts who would get each proposed role, with names, and changes nothing", async () => {
    const { prisma, guild, add } = setup();
    const preview = await previewRankRoles(prisma as never, guild as never, [{ rankIndex: 1, discordRoleId: "officer" }, { rankIndex: 4, discordRoleId: "member" }], now);
    expect(preview.skipped).toBeNull();
    expect(preview.roles).toEqual([
      { discordRoleId: "officer", rankIndex: 1, gain: ["Alice", "Bob"] },
      { discordRoleId: "member", rankIndex: 4, gain: ["Cara"] }
    ]);
    // Cara holds the officer role but is rank 4: she would lose it.
    expect(preview.lose).toBe(1);
    expect(add).not.toHaveBeenCalled();
    const text = formatRankRolePreview(preview, 1);
    expect(text).toContain("Rank 1 → <@&officer>: **2** member(s) would get it (Alice, Bob)");
    expect(text).not.toContain("Rank 4");
    expect(text).toContain("1 member(s) would lose");
  });

  it("previews even while rank roles are off (turning them on is what is being decided)", async () => {
    const { prisma, guild } = setup({ enabled: false });
    const preview = await previewRankRoles(prisma as never, guild as never, [{ rankIndex: 1, discordRoleId: "officer" }], now);
    expect(preview.skipped).toBeNull();
    expect(preview.roles[0]?.gain).toEqual(["Alice", "Bob"]);
  });

  it("shortens a long sample and says when nobody would change", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `u${index}`, name: `Member ${index}`, rank: 2 }));
    const { prisma, guild } = setup({ people: many });
    const text = formatRankRolePreview(await previewRankRoles(prisma as never, guild as never, [{ rankIndex: 2, discordRoleId: "raider" }], now));
    expect(text).toContain("**8** member(s)");
    expect(text).toContain(", +3)");

    const done = setup({ people: [{ id: "u1", name: "Alice", rank: 2, roles: ["raider"] }] });
    expect(formatRankRolePreview(await previewRankRoles(done.prisma as never, done.guild as never, [{ rankIndex: 2, discordRoleId: "raider" }], now)))
      .toContain("Nobody would change");
  });

  it("says why when the proposed role cannot be managed", async () => {
    const { prisma, guild } = setup();
    guild.roles.cache.get = (id: string) => ({ id, name: id, editable: false });
    const preview = await previewRankRoles(prisma as never, guild as never, [{ rankIndex: 1, discordRoleId: "officer" }], now);
    expect(formatRankRolePreview(preview)).toMatch(/cannot manage the role officer/);
  });
});
