import { beforeEach, describe, expect, it, vi } from "vitest";

// The panel runs against the real claimCharacter, unlinkNotMine, unlinkCharacter and detachCharacter, on an in-memory
// stand-in for Prisma. Only Discord's side (the guild service's addCharacter, the officer log, the follow-up DM) is replaced.
const world = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };
  return { characters: [] as Row[], unclaimed: [] as Row[], claims: [] as Row[], log: [] as string[], dms: [] as unknown[] };
});

vi.mock("../src/services/companion-link-dm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/companion-link-dm.js")>()),
  tellAutoLinked: vi.fn(async (...args: unknown[]) => { world.dms.push(args); })
}));
vi.mock("../src/services/housekeeping.js", () => ({ postToLogChannel: vi.fn(async (_guild: unknown, text: string) => { world.log.push(text); }) }));
vi.mock("../src/services/guild.js", () => ({
  createGuildService: () => ({
    addCharacter: async (input: Record<string, unknown>) => {
      world.characters.push({ id: `new-${world.characters.length}`, guildId: "g1", detachedAt: null, level: 10, className: "Mage", ...input } as never);
    }
  })
}));

import { characterKey } from "../companion/character-identity.mjs";
import { allowTypedAttempt, characterPanel, handlePanelInteraction, openPanelFor, resetTypedAttempts } from "../src/services/character-panel.js";

type Row = typeof world.characters[number];
const extraServers: { name: string; discordId: string }[] = [];
const MEMBERS: Record<string, { id: string; guildId: string; displayName: string; guild: { name: string; discordId: string } }> = {
  "u1:dg1": { id: "m1", guildId: "g1", displayName: "Ray Player", guild: { name: "Québec Gold", discordId: "dg1" } },
  "u2:dg1": { id: "m2", guildId: "g1", displayName: "Zed Owner", guild: { name: "Québec Gold", discordId: "dg1" } },
  "u3:dg2": { id: "m3", guildId: "g2", displayName: "Other Server", guild: { name: "Elsewhere", discordId: "dg2" } }
};
const ch = (id: string, memberId: string, name: string, isMain = false, detachedAt: Date | null = null, guildId = "g1"): Row =>
  ({ id, guildId, memberId, name, className: "Mage", level: 60, isMain, detachedAt, displayName: null, realm: "Forever", gameEdition: "forever", linkEvidence: null, confirmedAt: null });
const fresh = (id: string, name: string, guildId = "g1"): Row => ({ id, guildId, name, nameKey: name.toLowerCase(), realm: "Forever", gameEdition: "forever", className: "Mage", level: 10, displayName: null, spec: null, race: null });

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    if (key === "member") return (MEMBERS[Object.keys(MEMBERS).find((k) => MEMBERS[k]!.id === row["memberId"]) ?? ""]?.guildId ?? "holding") === (want as { guildId: string }).guildId || row["memberId"] === `holding-${(want as { guildId: string }).guildId}`;
    if (key === "OR") return (want as Record<string, unknown>[]).some((sub) => matches(row, sub));
    const have = row[key];
    if (want && typeof want === "object" && "equals" in (want as object)) return String(have).toLowerCase() === String((want as { equals: string }).equals).toLowerCase();
    return have === want;
  });
}

function database() {
  const withMember = (row: Row | undefined) => {
    if (!row) return null;
    const owner = Object.values(MEMBERS).find((m) => m.id === row["memberId"]) ?? { id: row["memberId"], guildId: row["guildId"], displayName: "Unlinked", guild: { name: "Québec Gold", discordId: "dg1" } };
    return { ...row, member: { ...owner, discordUserId: Object.keys(MEMBERS).find((k) => MEMBERS[k]!.id === owner.id)?.split(":")[0] ?? "detached" } };
  };
  const db = {
    member: {
      findFirst: vi.fn(async ({ where }: { where: { discordUserId: string; guild: { discordId: string } } }) => MEMBERS[`${where.discordUserId}:${where.guild.discordId}`] ?? null),
      findMany: vi.fn(async ({ where, take = 1000 }: { where: { discordUserId: string; guild?: { discordId: string } }; take?: number }) =>
        Object.entries(MEMBERS).filter(([key, m]) => key.startsWith(`${where.discordUserId}:`) && (!where.guild || m.guild.discordId === where.guild.discordId)).map(([, m]) => ({ guild: m.guild })).concat(extraServers.map((guild) => ({ guild }))).slice(0, take)),
      upsert: vi.fn(async ({ create }: { create: { guildId: string } }) => ({ id: `holding-${create.guildId}` }))
    },
    guildSettings: { findUnique: vi.fn(async () => ({ language: "fr" })) },
    character: {
      findMany: vi.fn(async ({ where, skip = 0, take = 1000 }: { where: Record<string, unknown>; skip?: number; take?: number }) =>
        world.characters.filter((r) => matches(r, where)).sort((a, b) => Number(b["isMain"]) - Number(a["isMain"]) || String(a["name"]).localeCompare(String(b["name"]))).slice(skip, skip + take)),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => world.characters.filter((r) => matches(r, where)).length),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => withMember(world.characters.find((r) => matches(r, where)))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => withMember(world.characters.find((r) => r.id === where.id))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(world.characters.find((r) => r.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: object }) => { for (const r of world.characters.filter((x) => matches(x, where))) Object.assign(r, data); })
    },
    unclaimedCharacter: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => world.unclaimed.filter((r) => matches(r, where))),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => world.unclaimed.find((r) => matches(r, where)) ?? null),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { world.unclaimed.splice(world.unclaimed.findIndex((r) => r.id === where.id), 1); })
    },
    professionSkill: { upsert: vi.fn(async () => ({})) },
    characterVerifyClaim: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ where, create, update }: { where: { guildId_memberId_nameKey: { memberId: string; nameKey: string } }; create: Row; update: object }) => {
        const key = where.guildId_memberId_nameKey;
        const found = world.claims.find((r) => r["memberId"] === key.memberId && r["nameKey"] === key.nameKey);
        if (found) return Object.assign(found, update);
        world.claims.push(create);
        return create;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { memberId: string; nameKey: string; status: { in: string[] } } }) => {
        for (let i = world.claims.length - 1; i >= 0; i--) {
          const r = world.claims[i]!;
          if (r["memberId"] === where.memberId && r["nameKey"] === where.nameKey && where.status.in.includes(String(r["status"]))) world.claims.splice(i, 1);
        }
      })
    },
    characterLinkConflict: { updateMany: vi.fn(async () => ({})) },
    guildRosterEntry: { findMany: vi.fn(async () => []) },
    memberLinkNotice: {},
    $transaction: vi.fn(async (work: unknown) => (typeof work === "function" ? (work as (tx: unknown) => unknown)(db) : Promise.all(work as unknown[])))
  };
  return db as unknown as Parameters<typeof characterPanel>[0] & typeof db;
}

type Kind = "select" | "button" | "modal";
function click(customId: string, kind: Kind, options: { user?: string; value?: string; text?: string } = {}) {
  const calls: string[] = [];
  const track = <T>(name: string, result: T) => vi.fn<(arg?: unknown) => Promise<T>>(async () => { calls.push(name); return result; });
  return {
    customId, user: { id: options.user ?? "u1" }, values: [options.value ?? ""], calls,
    client: { guilds: { fetch: async () => ({}) } },
    fields: { getTextInputValue: () => options.text ?? "" },
    isModalSubmit: () => kind === "modal", isButton: () => kind === "button", isStringSelectMenu: () => kind === "select",
    deferUpdate: track("defer", undefined), deferReply: track("defer", undefined), editReply: track("edit", undefined),
    reply: track("reply", undefined), showModal: track("modal", undefined)
  };
}
const shown = (interaction: ReturnType<typeof click>) => JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]);
const ids = (view: Awaited<ReturnType<typeof characterPanel>>) => view.components.flatMap((r) => r.toJSON().components.map((c) => (c as { custom_id?: string; url?: string }).custom_id ?? (c as { url?: string }).url));
const run = (interaction: ReturnType<typeof click>, db: ReturnType<typeof database>) => handlePanelInteraction(interaction as never, db);

beforeEach(() => {
  world.characters.length = 0; world.unclaimed.length = 0; world.claims.length = 0; world.log.length = 0; world.dms.length = 0;
  resetTypedAttempts(); extraServers.length = 0;
});

describe("character panel", () => {
  it("lists only the member's attached characters, in French, with the controls", async () => {
    world.characters.push(ch("a", "m1", "Ray", true), ch("b", "m1", "Rayne"), ch("c", "m2", "Other"), ch("d", "m1", "Old", false, new Date()));
    const view = await characterPanel(database(), "u1", "dg1");
    expect(view.content).toContain("Tes personnages");
    expect(view.content).toContain("Ray");
    expect(view.content).not.toContain("Other");
    expect(view.content).not.toContain("Old");
    expect(ids(view)).toEqual(expect.arrayContaining(["linked:p:link:dg1", "linked:p:refresh:dg1:0", "linked:p:main:dg1", "linked:p:unlink:dg1", expect.stringContaining("/me/pictures/")]));
  });

  it("answers a stranger without showing anyone's characters", async () => {
    world.characters.push(ch("a", "m1", "Ray"));
    const view = await characterPanel(database(), "u9", "dg1");
    expect(view.content).not.toContain("Ray");
    expect(view.components).toHaveLength(0);
  });

  it("acknowledges before any database work, except the click that opens the name box", async () => {
    world.characters.push(ch("a", "m1", "Ray", true));
    const db = database();
    const refresh = click("linked:p:refresh:dg1", "button");
    await run(refresh, db);
    expect(refresh.calls[0]).toBe("defer");
    expect(refresh.deferUpdate).toHaveBeenCalledTimes(1);
    const modal = click("linked:p:namemodal:dg1", "modal", { text: "Nobody" });
    await run(modal, db);
    expect(modal.calls[0]).toBe("defer");
    expect(modal.deferReply).toHaveBeenCalledTimes(1);
    const name = click("linked:p:name:dg1", "button");
    await run(name, db);
    expect(name.calls).toEqual(["modal"]);
  });

  it("refuses a press for a server the member is not in, and for a forged server id", async () => {
    world.characters.push(ch("a", "m1", "Ray", true), ch("z", "m3", "Far", true, null, "g2"));
    const db = database();
    const outsider = click("linked:p:refresh:dg2", "button"); // u1 is not a member of dg2
    await run(outsider, db);
    expect(shown(outsider)).toContain("plus membre");
    expect(shown(outsider)).not.toContain("Far");
  });

  it("never sets the main or unlinks a character that belongs to someone else", async () => {
    world.characters.push(ch("a", "m1", "Ray", true), ch("c", "m2", "Other", true));
    const db = database();
    await run(click("linked:p:main:dg1", "select", { value: "c" }), db);
    expect(world.characters.find((r) => r.id === "c")!["isMain"]).toBe(true);
    expect(db.$transaction).not.toHaveBeenCalled();
    const ask = click("linked:p:unlink:dg1", "select", { value: "c" });
    await run(ask, db);
    expect(shown(ask)).not.toContain("linked:p:ok");
    // Even a hand-made confirm button for it does nothing.
    await run(click("linked:p:ok:dg1:c", "button"), db);
    expect(world.characters.find((r) => r.id === "c")).toMatchObject({ memberId: "m2", detachedAt: null });
    expect(world.claims).toHaveLength(0);
    expect(world.log).toHaveLength(0);
  });

  it("sets the main on the member's own character", async () => {
    world.characters.push(ch("a", "m1", "Ray", true), ch("b", "m1", "Rayne"));
    await run(click("linked:p:main:dg1", "select", { value: "b" }), database());
    expect(world.characters.map((r) => [r.id, r["isMain"]])).toEqual([["a", false], ["b", true]]);
  });

  it("unlinks only after the confirmation: detached, BLOCKED, another main promoted, one officer log line worded for the panel; a stale confirm does nothing", async () => {
    world.characters.push(ch("a", "m1", "Ray", true), ch("b", "m1", "Rayne"));
    const db = database();
    const ask = click("linked:p:unlink:dg1", "select", { value: "a" });
    await run(ask, db);
    expect(shown(ask)).toContain("linked:p:ok:dg1:a");
    expect(world.characters.find((r) => r.id === "a")!["detachedAt"]).toBeNull(); // nothing yet
    const ok = click("linked:p:ok:dg1:a", "button");
    await run(ok, db);
    expect(world.characters.find((r) => r.id === "a")).toMatchObject({ memberId: "holding-g1", isMain: false });
    expect(world.characters.find((r) => r.id === "a")!["detachedAt"]).toBeInstanceOf(Date);
    expect(world.characters.find((r) => r.id === "b")!["isMain"]).toBe(true);
    expect(world.claims).toEqual([{ guildId: "g1", memberId: "m1", nameKey: characterKey("Ray", "Forever", "forever"), status: "BLOCKED" }]);
    expect(world.log).toHaveLength(1);
    expect(world.log[0]).toContain("panneau"); // the panel's own wording, not the "Not mine" button's
    expect(world.log[0]).not.toContain("Pas à moi");
    // The same button pressed again (a stale panel): no second block write, no second log line.
    const again = click("linked:p:ok:dg1:a", "button");
    await run(again, db);
    expect(world.log).toHaveLength(1);
    expect(world.claims).toHaveLength(1);
  });

  it("links an unclaimed character through claimCharacter and clears this member's own earlier BLOCKED", async () => {
    world.characters.push(ch("a", "m1", "Ray", true));
    world.unclaimed.push(fresh("x", "Fresh"));
    world.claims.push({ id: "k", guildId: "g1", memberId: "m1", nameKey: characterKey("Fresh", "Forever", "forever"), status: "BLOCKED" });
    const done = click("linked:p:claim:dg1", "select", { value: "x" });
    await run(done, database());
    expect(world.characters.find((r) => r["name"] === "Fresh")).toMatchObject({ memberId: "m1", isMain: false });
    expect(world.unclaimed).toHaveLength(0);
    expect(world.claims).toHaveLength(0);
    expect(world.dms).toHaveLength(1);
    expect(shown(done)).toContain("Fresh");
  });

  it("links a typed name from the name box", async () => {
    world.unclaimed.push(fresh("x", "Fresh"));
    const typed = click("linked:p:namemodal:dg1", "modal", { text: " fresh " });
    await run(typed, database());
    expect(world.characters.find((r) => r["name"] === "Fresh")).toMatchObject({ memberId: "m1", isMain: true });
    expect(typed.reply).not.toHaveBeenCalled(); // answered through the deferred reply
    expect(shown(typed)).toContain("Fresh");
  });

  it("shows one generic line for every refused link: nothing about who holds a character", async () => {
    world.characters.push(ch("a", "m1", "Ray", true), ch("h", "m2", "Held", true), ch("h2", "m3", "Faraway", true, null, "g2"));
    world.unclaimed.push(fresh("far", "Elsewhere", "g2"));
    const db = database();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const attempts = [
      click("linked:p:namemodal:dg1", "modal", { text: "Held" }), // held by Zed Owner
      click("linked:p:namemodal:dg1", "modal", { text: "Nobody" }), // does not exist
      click("linked:p:claim:dg1", "select", { value: "far" }), // an unclaimed row of ANOTHER server
      click("linked:p:claim:dg1", "select", { value: "ghost" }) // a forged id
    ];
    for (const attempt of attempts) {
      await run(attempt, db);
      const text = shown(attempt);
      expect(text).toContain("pas disponible");
      for (const leak of ["Zed Owner", "already linked", "No unclaimed", "Held ", "someone"]) expect(text).not.toContain(leak);
    }
    expect(warn).toHaveBeenCalledTimes(4); // the detail is logged
    warn.mockRestore();
    expect(world.characters.find((r) => r.id === "h")).toMatchObject({ memberId: "m2" });
    expect(world.unclaimed.map((r) => r.id)).toEqual(["far"]);
    expect(world.characters.filter((r) => r["memberId"] === "m1")).toHaveLength(1);
  });

  it("limits typed-name attempts per member, but not the menu", async () => {
    world.unclaimed.push(fresh("x", "Fresh"));
    const db = database();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) await run(click("linked:p:namemodal:dg1", "modal", { text: `guess${i}` }), db);
    const sixth = click("linked:p:namemodal:dg1", "modal", { text: "Fresh" });
    await run(sixth, db);
    expect(shown(sixth)).toContain("Trop d");
    expect(world.unclaimed).toHaveLength(1); // not even tried
    const menu = click("linked:p:claim:dg1", "select", { value: "x" });
    await run(menu, db);
    expect(world.unclaimed).toHaveLength(0);
    warn.mockRestore();
    expect(allowTypedAttempt("someone-else")).toBe(true);
    // The window slides: ten minutes later the member may try again.
    expect(allowTypedAttempt("u1", Date.now() + 11 * 60 * 1000)).toBe(true);
  });

  it("pages through more than 25 characters and says how many are on the other pages", async () => {
    world.characters.push(ch("main", "m1", "Aaa", true));
    for (let i = 0; i < 29; i++) world.characters.push(ch(`c${i}`, "m1", `Char${String(i).padStart(2, "0")}`));
    const db = database();
    const first = await characterPanel(db, "u1", "dg1");
    expect(first.content).toContain("Page 1 sur 2");
    expect(first.content).toContain("5 autre");
    expect(ids(first)).toContain("linked:p:page:dg1:1");
    const options = first.components.flatMap((r) => r.toJSON().components).filter((c) => c.type === 3).map((c) => (c as { options: unknown[] }).options.length);
    expect(Math.max(...options)).toBeLessThanOrEqual(25);
    const next = click("linked:p:page:dg1:1", "button");
    await run(next, db);
    expect(shown(next)).toContain("Page 2 sur 2");
    expect(shown(next)).toContain("Char28");
    expect(shown(next)).not.toContain("Aaa");
    const past = click("linked:p:page:dg1:9", "button"); // a forged page number lands on the last page
    await run(past, db);
    expect(shown(past)).toContain("Page 2 sur 2");
  });
});

describe("opening the panel from a DM button", () => {
  const press = (guildId: string | null = null) => ({ user: { id: "u1" }, guildId, editReply: vi.fn<(view?: unknown) => Promise<void>>(async () => undefined) });
  const sent = (p: ReturnType<typeof press>) => JSON.stringify(p.editReply.mock.calls[0]?.[0]);

  it("one server: shows that panel (or the link step) straight away, editing the deferred reply", async () => {
    world.characters.push(ch("a", "m1", "Ray", true));
    world.unclaimed.push(fresh("x", "Fresh"));
    const panel = press();
    await openPanelFor(panel as never, database(), "panel");
    expect(sent(panel)).toContain("Ray");
    expect(sent(panel)).toContain("linked:p:link:dg1");
    const link = press();
    await openPanelFor(link as never, database(), "link");
    expect(sent(link)).toContain("linked:p:claim:dg1");
    expect(sent(link)).toContain("Fresh");
  });

  it("no server: says so in both languages", async () => {
    const stranger = { user: { id: "nobody" }, guildId: null, editReply: vi.fn<(view?: unknown) => Promise<void>>(async () => undefined) };
    await openPanelFor(stranger as never, database(), "panel");
    expect(JSON.stringify(stranger.editReply.mock.calls[0]?.[0])).toContain("pas encore de personnage");
  });

  it("several servers: one button each, and a note when there are more than ten", async () => {
    for (let i = 0; i < 12; i++) extraServers.push({ name: `S${i}`, discordId: `x${i}` });
    const choice = press();
    await openPanelFor(choice as never, database(), "panel");
    const text = sent(choice);
    expect(text).toContain("linked:p:refresh:dg1");
    expect(text).toContain("Use /character");
    const buttons = (choice.editReply.mock.calls[0]?.[0] as { components: { toJSON(): { components: unknown[] } }[] }).components.flatMap((r) => r.toJSON().components);
    expect(buttons).toHaveLength(10);
  });
});

