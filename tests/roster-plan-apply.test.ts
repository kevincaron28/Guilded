import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { prismaRosterPlanWriter } from "../src/services/roster-plan-store.js";
import { loadRosterSnapshot } from "../src/services/roster-dashboard-store.js";
import { approvedMainPlan, createRosterReview, mainPlanApproval, mainPlanRevision } from "../src/services/roster-review.js";
import { csrfToken } from "../src/services/web-auth.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";

const guild = { id: "g", name: "Guild", edition: "forever" };
const csv = "character,realm,main\nArden River,,false\nMira Stone,,true";
const now = new Date("2026-10-26T12:00:00Z");
function fixture() {
  let rows = [true, false].map((isMain, i) => ({ id: `c${i}`, name: i ? "mira" : "arden", displayName: i ? "Mira Stone" : "Arden River",
    realm: "Forever", className: "Priest", race: null, level: 60, memberId: "m", isMain, lastSeenAt: null, updatedAt: now, professions: [] }));
  const character = { findMany: vi.fn(async () => rows.map(row => ({ ...row }))), updateMany: vi.fn(async ({ where, data }) => {
    const row = rows.find(row => row.id === where.id && row.memberId === where.memberId && row.isMain === where.isMain && row.updatedAt === where.updatedAt);
    if (!row) return { count: 0 }; row.isMain = data.isMain; return { count: 1 };
  }) };
  const auditLog = { create: vi.fn(async () => ({ id: "audit1" })) };
  const db = { character, unclaimedCharacter: { findMany: vi.fn(async () => []) }, member: { findFirst: vi.fn(async () => ({ id: "officer" })) }, auditLog,
    $transaction: vi.fn(async fn => { const before = rows.map(row => ({ ...row })); try { return await fn(db); } catch (error) { rows = before; throw error; } }) };
  const access = { authorize: vi.fn(async (): Promise<typeof guild | null> => guild), guilds: vi.fn(async () => [guild]) };
  const database = db as unknown as PrismaClient;
  return { db, database, access, writer: prismaRosterPlanWriter(database, access), rows: () => rows, snapshot: () => loadRosterSnapshot(database, guild) };
}

describe("audited main/alt application", () => {
  it("changes only main flags in one serializable transaction and refuses replay", async () => {
    const f = fixture(); const revision = mainPlanRevision(await f.snapshot());
    expect(await f.writer.apply("officer", "g", csv, revision)).toEqual({ auditId: "audit1", changes: 2 });
    expect(f.rows().map(row => row.isMain)).toEqual([false, true]);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", maxWait: 15000, timeout: 15000 });
    expect(f.db.character.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "g", gameEdition: "forever", memberId: "m" }), data: { isMain: true } }));
    expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "officer", action: "MEMBER_UPDATED", metadata: expect.objectContaining({ changes: expect.arrayContaining([expect.objectContaining({ before: true, after: false })]) }) }) }));
    await expect(f.writer.apply("officer", "g", csv, revision)).rejects.toThrow("Roster changed");
  });
  it("rejects lost access, stale data, ambiguous/conflicting plans and membership loss", async () => {
    const f = fixture(); const revision = mainPlanRevision(await f.snapshot());
    f.access.authorize.mockResolvedValueOnce(null);
    await expect(f.writer.apply("officer", "g", csv, revision)).rejects.toThrow("Access changed");
    expect(f.db.$transaction).not.toHaveBeenCalled();
    await expect(f.writer.apply("officer", "g", csv, "stale")).rejects.toThrow("Roster changed");
    await expect(f.writer.apply("officer", "g", "character,realm,main\nMira Stone,,true", revision)).rejects.toThrow("conflicts");
    expect(f.db.character.updateMany).not.toHaveBeenCalled();
    f.db.member.findFirst.mockResolvedValueOnce(null as never);
    await expect(f.writer.apply("officer", "g", csv, revision)).rejects.toThrow("Membership changed");
  });
  it("rolls back the whole batch if a later character changes or audit persistence fails", async () => {
    for (const failure of ["character", "audit"]) {
      const f = fixture(); const revision = mainPlanRevision(await f.snapshot());
      if (failure === "audit") f.db.auditLog.create.mockRejectedValueOnce(new Error("unavailable"));
      else f.db.character.updateMany.mockImplementationOnce(async () => { f.rows()[0]!.isMain = false; return { count: 1 }; }).mockResolvedValueOnce({ count: 0 });
      await expect(f.writer.apply("officer", "g", csv, revision)).rejects.toThrow();
      expect(f.rows().map(row => row.isMain)).toEqual([true, false]);
    }
  });
});

describe("main-plan confirmation", () => {
  it("binds confirmation to the reviewed text, actor, session, scope, roster and five-minute deadline", async () => {
    const snapshot = await fixture().snapshot();
    const token = mainPlanApproval(snapshot, csv, "officer", "session", "secret", now);
    const valid = (s = snapshot, plan = csv, actor = "officer", session = "session", at = now, signed = token) => approvedMainPlan(signed, s, plan, actor, session, "secret", at);
    expect(valid()).toBe(true);
    expect(valid(snapshot, csv + "\n")).toBe(false);
    expect(valid(snapshot, csv, "another")).toBe(false);
    expect(valid(snapshot, csv, "officer", "another")).toBe(false);
    expect(valid({ ...snapshot, guild: { ...guild, edition: "retail" } })).toBe(false);
    expect(valid({ ...snapshot, characters: snapshot.characters.slice(1) })).toBe(false);
    expect(valid(snapshot, csv, "officer", "session", new Date(now.getTime() + 300_000))).toBe(false);
    expect(valid(snapshot, csv, "officer", "session", now, token + "tampered")).toBe(false);
  });
  it("requires CSRF, typed confirmation and the signed preview before invoking the writer", async () => {
    const f = fixture(); const snapshot = await f.snapshot(); const auth = { clientId: "x", clientSecret: "x", sessionSecret: "secret", siteUrl: "https://guilded.test" };
    const writer = { apply: vi.fn(async () => ({ auditId: "audit", changes: 2 })) };
    const route = createRosterReview({ guilds: async () => [guild], load: async () => snapshot }, writer);
    const kit: WebKit = { page: (status, _title, body) => ({ status, body, headers: {} }), redirect: location => ({ status: 302, headers: { location }, body: "" }), signInPrompt: () => ({ status: 401, headers: {}, body: "" }) };
    const ctx: WebContext = { request: { method: "POST", path: "/me/roster/review", query: new URLSearchParams("guild=g"), headers: { origin: auth.siteUrl } }, account: { id: "a", discordUserId: "officer", username: "Officer", displayName: null }, lang: "en", t: en => en, now, auth, sessionToken: "session", csrf: csrfToken("secret", "session"), form: new URLSearchParams({ plan: csv }) };
    expect((await route(ctx, kit))?.status).toBe(403);
    ctx.form!.set("csrf", ctx.csrf!);
    expect((await route(ctx, kit))?.body).toContain("Apply changes");
    ctx.form!.set("intent", "apply"); ctx.form!.set("confirm", "APPLY");
    expect((await route(ctx, kit))?.status).toBe(409); expect(writer.apply).not.toHaveBeenCalled();
    ctx.form!.set("approval", mainPlanApproval(snapshot, csv, "officer", "session", "secret", now));
    expect((await route(ctx, kit))?.body).toContain("Main/alt changes saved");
    expect(writer.apply).toHaveBeenCalledOnce();
  });
});
