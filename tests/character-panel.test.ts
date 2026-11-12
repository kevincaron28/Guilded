import { describe, expect, it, vi } from "vitest";

const unlink = vi.hoisted(() => vi.fn(async () => "unlinked ok"));
const claimMock = vi.hoisted(() => vi.fn());
vi.mock("../src/services/companion-link-dm.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/services/companion-link-dm.js")>()), unlinkNotMine: unlink, tellAutoLinked: vi.fn(async () => undefined) }));
vi.mock("../src/services/character-autolink.js", () => ({ claimCharacter: claimMock }));

import { characterPanel, handlePanelInteraction } from "../src/services/character-panel.js";

type Row = { id: string; memberId: string; name: string; className: string; level: number | null; isMain: boolean; detachedAt: Date | null; displayName: null; realm: string; linkEvidence: null; confirmedAt: null };
const ch = (id: string, memberId: string, name: string, isMain = false, detachedAt: Date | null = null): Row => ({ id, memberId, name, className: "Mage", level: 60, isMain, detachedAt, displayName: null, realm: "Forever", linkEvidence: null, confirmedAt: null });

function fake(rows: Row[], unclaimed: { id: string; name: string; className: string; level: number | null; displayName: null }[] = []) {
  const db = {
    member: { findFirst: vi.fn(async ({ where }: { where: { discordUserId: string; guild: { discordId: string } } }) => where.discordUserId === "u1" && where.guild.discordId === "dg1" ? { id: "m1", guildId: "g1", guild: { name: "Québec Gold", discordId: "dg1" } } : null) },
    guildSettings: { findUnique: vi.fn(async () => ({ language: "fr" })) },
    // Honour the filters the panel passes: owner and attached rows only.
    character: {
      findMany: vi.fn(async ({ where }: { where: { memberId?: string; detachedAt?: null } }) => rows.filter((r) => (where.memberId === undefined || r.memberId === where.memberId) && (where.detachedAt === undefined || r.detachedAt === where.detachedAt))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
      updateMany: vi.fn(async () => ({})), update: vi.fn(async () => ({}))
    },
    unclaimedCharacter: { findMany: vi.fn(async () => unclaimed) },
    characterVerifyClaim: { findMany: vi.fn(async () => []) },
    guildRosterEntry: { findMany: vi.fn(async () => []) },
    memberLinkNotice: {},
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops))
  };
  return db as unknown as Parameters<typeof characterPanel>[0] & typeof db;
}
const ids = (view: Awaited<ReturnType<typeof characterPanel>>) => view.components.flatMap((r) => r.toJSON().components.map((c) => (c as { custom_id?: string; url?: string }).custom_id ?? (c as { url?: string }).url));

describe("character panel", () => {
  it("lists only the member's attached characters, in French, with the controls", async () => {
    const db = fake([ch("a", "m1", "Ray", true), ch("b", "m1", "Rayne"), ch("c", "m2", "Other"), ch("d", "m1", "Old", false, new Date())]);
    const view = await characterPanel(db, "u1", "dg1");
    expect(view.content).toContain("Tes personnages");
    expect(view.content).toContain("Ray");
    expect(view.content).not.toContain("Other");
    expect(view.content).not.toContain("Old");
    expect(ids(view)).toEqual(expect.arrayContaining(["linked:p:link:dg1", "linked:p:refresh:dg1", "linked:p:main:dg1", "linked:p:unlink:dg1", expect.stringContaining("/me/pictures/")]));
  });

  it("answers a stranger without showing anyone's characters", async () => {
    const view = await characterPanel(fake([ch("a", "m1", "Ray")]), "u9", "dg1");
    expect(view.content).not.toContain("Ray");
    expect(view.components).toHaveLength(0);
  });

  const select = (customId: string, value: string, user = "u1") => ({ customId, values: [value], user: { id: user }, client: {}, isModalSubmit: () => false, isButton: () => false, isStringSelectMenu: () => true, update: vi.fn(async (_view?: unknown) => undefined), reply: vi.fn(async (_view?: unknown) => undefined) });

  it("never sets the main or unlinks a character that belongs to someone else", async () => {
    const db = fake([ch("a", "m1", "Ray", true), ch("c", "m2", "Other")]);
    const main = select("linked:p:main:dg1", "c");
    await handlePanelInteraction(main as never, db);
    expect(db.$transaction).not.toHaveBeenCalled();
    const gone = select("linked:p:unlink:dg1", "c");
    await handlePanelInteraction(gone as never, db);
    expect(JSON.stringify(gone.update.mock.calls[0]?.[0])).not.toContain("linked:p:ok");
    expect(unlink).not.toHaveBeenCalled();
  });

  it("sets the main on the member's own character, and unlinks only after the confirmation button", async () => {
    const db = fake([ch("a", "m1", "Ray", true), ch("b", "m1", "Rayne")]);
    await handlePanelInteraction(select("linked:p:main:dg1", "b") as never, db);
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: "b" }, data: { isMain: true } });
    const ask = select("linked:p:unlink:dg1", "b");
    await handlePanelInteraction(ask as never, db);
    expect(unlink).not.toHaveBeenCalled();
    expect(JSON.stringify(ask.update.mock.calls[0]?.[0])).toContain("linked:p:ok:dg1:b");
    const ok = { ...select("linked:p:ok:dg1:b", ""), isButton: () => true, isStringSelectMenu: () => false };
    await handlePanelInteraction(ok as never, db);
    expect(unlink).toHaveBeenCalledWith(expect.anything(), expect.anything(), "u1", "b");
  });

  it("links through claimCharacter, which refuses characters somebody already holds", async () => {
    const db = fake([ch("a", "m1", "Ray", true)], [{ id: "x", name: "Fresh", className: "Mage", level: 10, displayName: null }]);
    claimMock.mockResolvedValueOnce({ row: { name: "Fresh", displayName: null }, isMain: false });
    const done = select("linked:p:claim:dg1", "x");
    await handlePanelInteraction(done as never, db);
    expect(claimMock).toHaveBeenCalledWith(expect.anything(), "g1", "m1", "x");
    expect(JSON.stringify(done.update.mock.calls[0]?.[0])).toContain("Fresh");
    claimMock.mockRejectedValueOnce(new Error("Ray is already linked to someone."));
    const taken = select("linked:p:claim:dg1", "x");
    await handlePanelInteraction(taken as never, db);
    expect(JSON.stringify(taken.update.mock.calls[0]?.[0])).toContain("already linked");
  });
});
