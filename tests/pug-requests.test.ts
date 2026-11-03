import { describe, expect, it, vi } from "vitest";
import { createPugWeb } from "../src/services/pug-web.js";
import {
  blockPugGuild, closePugRequest, createPugRequest, decidePugSignup, fanOutPugRequest, isFilled, joinPugBoard, openCounts, publicPugRequests, pugTargets, PUG_LIMITS, PugError,
  signUpForPug, sweepPugRequests, unblockPugGuild
} from "../src/services/pug-requests.js";

const now = new Date("2026-11-05T12:00:00Z");
const later = new Date("2026-11-07T20:00:00Z");
const allowAll = () => true;

interface Row { id?: string; raidId?: string; guildId?: string; requestId?: string; discordUserId?: string; status?: string; revision?: number; removedAt?: unknown; [key: string]: unknown }
interface Board { guildId: string; channelId: string; guild: { discordId: string; gameEdition: string } }

// A tiny in-memory stand-in for the Prisma calls the service makes.
function fake(options: { boards?: Board[]; blocks?: { guildId: string; blockedGuildId: string }[]; raid?: Row | null; requests?: Row[]; members?: { guildId: string }[]; recent?: number; last?: Date | null } = {}) {
  const requests: Row[] = options.requests ?? [];
  const posts: Row[] = [];
  const signups: Row[] = [];
  const jobs = new Map<string, Row>();
  const raid = options.raid === undefined ? { id: "r1", guildId: "g1", title: "Karazhan", status: "PLANNED", isTest: false, scheduledAt: later, guild: { gameEdition: "classic-tbc" } } : options.raid;
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    pugBoardGuild: {
      findUnique: vi.fn(async ({ where }: { where: { guildId: string } }) => (options.boards ?? []).find(b => b.guildId === where.guildId) ?? null),
      findMany: vi.fn(async ({ where }: { where?: { guildId?: { not: string }; guild?: { gameEdition: string } } } = {}) =>
        (options.boards ?? []).filter(b => (!where?.guildId || b.guildId !== where.guildId.not) && (!where?.guild || b.guild.gameEdition === where.guild.gameEdition))),
      upsert: vi.fn(async ({ create }: { create: { guildId: string; channelId: string } }) => { (options.boards ??= []).push({ ...create, guild: { discordId: `d${create.guildId.slice(1)}`, gameEdition: "classic-tbc" } }); }), delete: vi.fn()
    },
    guild: { findUnique: vi.fn(async () => ({ gameEdition: "classic-tbc" })) },
    pugBlock: {
      findMany: vi.fn(async ({ where }: { where: { OR?: { guildId?: string; blockedGuildId?: string }[]; guildId?: string } }) =>
        (options.blocks ?? []).filter(b => where.OR ? where.OR.some(c => c.guildId === b.guildId || c.blockedGuildId === b.blockedGuildId) : b.guildId === where.guildId)),
      upsert: vi.fn(async ({ create }: { create: { guildId: string; blockedGuildId: string } }) => { (options.blocks ??= []).push(create); }),
      deleteMany: vi.fn(async ({ where }: { where: { guildId: string; blockedGuildId: string } }) => {
        const before = options.blocks?.length ?? 0;
        options.blocks = (options.blocks ?? []).filter(b => !(b.guildId === where.guildId && b.blockedGuildId === where.blockedGuildId));
        return { count: before - options.blocks.length };
      })
    },
    raid: { findFirst: vi.fn(async () => raid), findUnique: vi.fn(async () => raid) },
    pugRequest: {
      findFirst: vi.fn(async ({ where }: { where: { raidId?: string; status?: string; guildId?: string } }) => {
        if (where.raidId) return requests.find(r => r.raidId === where.raidId && r.status === where.status) ?? null;
        return options.last === undefined ? null : options.last ? { createdAt: options.last } : null;
      }),
      count: vi.fn(async () => options.recent ?? 0),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `req${requests.length + 1}`, status: "OPEN", createdAt: now, ...data }; requests.push(row); return row; }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = requests.find(r => r.id === where.id);
        return row ? { ...row, signups, guild: { discordId: "d1" } } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { status?: string; guildId?: { not?: string; in?: string[] }; edition?: string } }) => requests.filter(r =>
        (!where.status || r.status === where.status) && (!where.guildId?.not || r.guildId !== where.guildId.not) && (!where.guildId?.in || where.guildId.in.includes(r.guildId as string)) && (!where.edition || r["edition"] === where.edition))),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Row }) => {
        const row = requests.find(r => r.id === where.id && r.status === where.status);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(requests.find(r => r.id === where.id)!, data)),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    },
    pugPost: {
      upsert: vi.fn(async ({ where, create }: { where: { requestId_guildId: { requestId: string; guildId: string } }; create: Row }) => {
        if (!posts.some(p => p.requestId === where.requestId_guildId.requestId && p.guildId === where.requestId_guildId.guildId)) posts.push({ id: `p${posts.length + 1}`, createdAt: now, removedAt: null, ...create });
      }),
      findMany: vi.fn(async ({ where }: { where: { requestId?: string; removedAt?: null } }) => posts.filter(p => (!where.requestId || p.requestId === where.requestId) && !p.removedAt)),
      updateMany: vi.fn(async ({ where, data }: { where: { requestId: string; guildId: string }; data: Row }) => {
        const hit = posts.filter(p => p.requestId === where.requestId && p.guildId === where.guildId && p.removedAt);
        hit.forEach(p => Object.assign(p, data));
        return { count: hit.length };
      })
    },
    pugSignup: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        if (signups.some(s => s.requestId === data.requestId && s.discordUserId === data.discordUserId)) throw Object.assign(new Error("dup"), { code: "P2002" });
        const row = { id: `s${signups.length + 1}`, status: "PENDING", ...data }; signups.push(row); return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = signups.find(s => s.id === where.id);
        return row ? { ...row, request: { ...requests.find(r => r.id === row.requestId), signups } } : null;
      }),
      findMany: vi.fn(async () => signups),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Row }) => {
        const row = signups.find(s => s.id === where.id && s.status === where.status);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      })
    },
    member: { findMany: vi.fn(async () => options.members ?? []) },
    // Accepts serialize on the request row. One transaction at a time, so the locked re-check
    // sees the other officer's accept. $queryRaw stands in for the row lock.
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn((work: (tx: unknown) => Promise<unknown>) => {
      const run = tail.then(() => work(db));
      tail = run.then(() => undefined, () => undefined);
      return run;
    }),
    discordJob: {
      upsert: vi.fn(async ({ where, create, update }: { where: { guildId_key: { guildId: string; key: string } }; create: Row; update: Row }) => {
        const key = `${where.guildId_key.guildId}/${where.guildId_key.key}`;
        const job = jobs.get(key) ? { ...jobs.get(key), ...update, revision: Number(jobs.get(key)!.revision) + 1 } : { id: key, revision: 1, ...create };
        jobs.set(key, job); return job;
      }),
      updateMany: vi.fn(async () => ({ count: 1 }))
    }
  };
  return { db: db as never, raw: db, requests, posts, signups, jobs };
}

const boards: Board[] = [
  { guildId: "g1", channelId: "c1", guild: { discordId: "d1", gameEdition: "classic-tbc" } },
  { guildId: "g2", channelId: "c2", guild: { discordId: "d2", gameEdition: "classic-tbc" } },
  { guildId: "g3", channelId: "c3", guild: { discordId: "d3", gameEdition: "classic-tbc" } },
  { guildId: "g4", channelId: "c4", guild: { discordId: "d4", gameEdition: "retail" } }
];
const want = { TANK: 1, HEALER: 2, DPS: 0 };
const input = { guildId: "g1", raidId: "r1", createdBy: "officer", want, hours: 24, note: "bring flasks" };

describe("PUG request creation", () => {
  it("refuses a guild that has not joined the board and creates nothing", async () => {
    const f = fake({ boards: [] });
    await expect(createPugRequest(f.db, input, allowAll, now)).rejects.toThrow("Join the PUG board");
    expect(f.requests).toHaveLength(0);
    expect(f.jobs.size).toBe(0);
  });

  it("fans out only to joined guilds of the same edition, never the requester", async () => {
    const f = fake({ boards });
    const { request, posts } = await createPugRequest(f.db, input, allowAll, now);
    expect(posts).toBe(2);
    expect(f.posts.map(p => p.guildId).sort()).toEqual(["g2", "g3"]); // g4 plays Retail; g1 is the requester
    expect([...f.jobs.keys()].sort()).toEqual([`g2/pug:${request.id}`, `g3/pug:${request.id}`]);
    expect(request.edition).toBe("classic-tbc");
  });

  it("does not post to guilds that have not joined (opt-in) even if they share the edition", async () => {
    const f = fake({ boards: boards.slice(0, 2) });
    await createPugRequest(f.db, input, allowAll, now);
    expect(f.posts.map(p => p.guildId)).toEqual(["g2"]);
  });

  it("skips guilds the pilot does not serve", async () => {
    const f = fake({ boards });
    await createPugRequest(f.db, input, id => id !== "d3", now);
    expect(f.posts.map(p => p.guildId)).toEqual(["g2"]);
  });

  it("is idempotent: repeating the fan-out reuses posts and job keys", async () => {
    const f = fake({ boards });
    const { request } = await createPugRequest(f.db, input, allowAll, now);
    await fanOutPugRequest(f.db, request.id as string, allowAll, now);
    await fanOutPugRequest(f.db, request.id as string, allowAll, now);
    expect(f.posts).toHaveLength(2);
    expect(f.jobs.size).toBe(2);
    expect(f.jobs.get(`g2/pug:${request.id}`)!.revision).toBe(3);
  });

  it("allows one active request per raid, a daily cap and a cooldown", async () => {
    const dup = fake({ boards, requests: [{ id: "old", raidId: "r1", status: "OPEN" }] });
    await expect(createPugRequest(dup.db, input, allowAll, now)).rejects.toThrow("already has an active");
    const cap = fake({ boards, recent: PUG_LIMITS.dailyRequests });
    await expect(createPugRequest(cap.db, input, allowAll, now)).rejects.toThrow("per day");
    const cool = fake({ boards, last: new Date(now.getTime() - 60_000) });
    await expect(createPugRequest(cool.db, input, allowAll, now)).rejects.toThrow("minutes between");
    const race = fake({ boards });
    race.raw.pugRequest.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(createPugRequest(race.db, input, allowAll, now)).rejects.toBeInstanceOf(PugError);
  });

  it("validates spots, raid state and caps the duration at 48 hours and the raid start", async () => {
    await expect(createPugRequest(fake({ boards }).db, { ...input, want: { TANK: 0, HEALER: 0, DPS: 0 } }, allowAll, now)).rejects.toThrow("at least one");
    await expect(createPugRequest(fake({ boards }).db, { ...input, want: { TANK: 99, HEALER: 0, DPS: 0 } }, allowAll, now)).rejects.toThrow("per role");
    await expect(createPugRequest(fake({ boards, raid: { id: "r1", guildId: "g1", title: "x", status: "ACTIVE", isTest: false, scheduledAt: later, guild: { gameEdition: "classic-tbc" } } }).db, input, allowAll, now)).rejects.toThrow("upcoming");
    await expect(createPugRequest(fake({ boards, raid: null }).db, input, allowAll, now)).rejects.toThrow("not found");
    const long = fake({ boards });
    expect((await createPugRequest(long.db, { ...input, hours: 500 }, allowAll, now)).request.expiresAt).toEqual(new Date(now.getTime() + 48 * 3_600_000));
    const soon = fake({ boards, raid: { id: "r1", guildId: "g1", title: "x", status: "PLANNED", isTest: false, scheduledAt: new Date(now.getTime() + 3_600_000), guild: { gameEdition: "classic-tbc" } } });
    expect((await createPugRequest(soon.db, input, allowAll, now)).request.expiresAt).toEqual(new Date(now.getTime() + 3_600_000));
  });
});

describe("block list", () => {
  it("hides a request from a guild that blocked the requester, and from guilds the requester blocked", async () => {
    const f = fake({ boards, blocks: [{ guildId: "g2", blockedGuildId: "g1" }] });
    expect((await pugTargets(f.db, { guildId: "g1", edition: "classic-tbc" }, allowAll)).map(t => t.guildId)).toEqual(["g3"]);
    const g = fake({ boards, blocks: [{ guildId: "g1", blockedGuildId: "g3" }] });
    expect((await pugTargets(g.db, { guildId: "g1", edition: "classic-tbc" }, allowAll)).map(t => t.guildId)).toEqual(["g2"]);
  });

  it("blocking queues a refresh so the blocked guild's existing post is removed", async () => {
    const f = fake({ boards, requests: [{ id: "req1", guildId: "g1", edition: "classic-tbc", status: "OPEN" }] });
    f.posts.push({ id: "p1", requestId: "req1", guildId: "g2", channelId: "c2", createdAt: now, removedAt: null });
    await blockPugGuild(f.db, "g2", "g1", allowAll);
    expect(f.jobs.has("g2/pug:req1")).toBe(true); // delivery re-checks eligibility and deletes the message
  });

  it("refuses a guild blocking itself", async () => {
    await expect(blockPugGuild(fake().db, "g1", "g1", allowAll)).rejects.toThrow("cannot block itself");
  });
});

describe("sign-ups and decisions", () => {
  const open = (extra: Row = {}) => ({ id: "req1", guildId: "g1", raidId: "r1", edition: "classic-tbc", status: "OPEN", scheduledAt: later, expiresAt: later, wantTank: 1, wantHealer: 0, wantDps: 1, createdBy: "officer", ...extra });
  const person = { requestId: "req1", discordUserId: "u1", displayName: "Alice", role: "TANK", characterName: "Aliceth", characterClass: "warrior", note: "hi" };

  it("records one sign-up per person per request and queues one aggregated notice", async () => {
    const f = fake({ requests: [open()] });
    const signup = await signUpForPug(f.db, person, allowAll, now);
    expect(signup).toMatchObject({ characterClass: "Warrior", status: "PENDING" });
    await expect(signUpForPug(f.db, person, allowAll, now)).rejects.toThrow("already signed up");
    await expect(signUpForPug(f.db, { ...person, discordUserId: "u2" }, allowAll, now)).resolves.toBeTruthy();
    expect(f.jobs.size).toBe(1); // both land in the single notice job of the requesting guild
    expect([...f.jobs.keys()]).toEqual(["g1/pugnotice:req1"]);
  });

  it("rejects closed, expired, full-role and invalid sign-ups", async () => {
    await expect(signUpForPug(fake({ requests: [open({ status: "CLOSED" })] }).db, person, allowAll, now)).rejects.toThrow("closed");
    await expect(signUpForPug(fake({ requests: [open({ expiresAt: new Date(now.getTime() - 1) })] }).db, person, allowAll, now)).rejects.toThrow("closed");
    await expect(signUpForPug(fake({ requests: [open()] }).db, { ...person, role: "HEALER" }, allowAll, now)).rejects.toThrow("full");
    await expect(signUpForPug(fake({ requests: [open()] }).db, { ...person, role: "BARD" }, allowAll, now)).rejects.toThrow("tank, healer or DPS");
    await expect(signUpForPug(fake({ requests: [open()] }).db, { ...person, characterName: "x" }, allowAll, now)).rejects.toThrow("character");
    await expect(signUpForPug(fake({ requests: [open()] }).db, person, id => id !== "d1", now)).rejects.toThrow("closed");
  });

  it("refuses members of the requesting guild or of a guild it blocked", async () => {
    const f = fake({ requests: [open()], members: [{ guildId: "g1" }] });
    await expect(signUpForPug(f.db, person, allowAll, now)).rejects.toThrow("not taking your sign-up");
    expect(f.signups).toHaveLength(0);
  });

  it("lets only the requesting guild decide, accepts idempotently and closes when every spot is filled", async () => {
    const f = fake({ boards, requests: [open({ wantDps: 0 })] });
    await signUpForPug(f.db, person, allowAll, now);
    await expect(decidePugSignup(f.db, "s1", "g2", true, allowAll, now)).rejects.toThrow("not found");
    expect(await decidePugSignup(f.db, "s1", "g1", true, allowAll, now)).toBe("accepted");
    expect(f.requests[0]).toMatchObject({ status: "CLOSED", closeReason: "filled" });
    expect(await decidePugSignup(f.db, "s1", "g1", true, allowAll, now)).toBe("already-decided");
  });

  it("declining keeps the request open; a declined person cannot sign up again", async () => {
    const f = fake({ requests: [open()] });
    await signUpForPug(f.db, person, allowAll, now);
    expect(await decidePugSignup(f.db, "s1", "g1", false, allowAll, now)).toBe("declined");
    expect(f.requests[0]!.status).toBe("OPEN");
    await expect(signUpForPug(f.db, person, allowAll, now)).rejects.toThrow("already signed up");
  });

  function noticeDelays(f: ReturnType<typeof fake>) {
    const calls = f.raw.discordJob.updateMany.mock.calls as unknown as [{ where: { id: string }; data: { nextAttemptAt: Date } }][];
    return calls.map((call) => call[0]).filter((call) => call.where.id.includes("pugnotice"));
  }

  it("accepts one role without closing the request, refreshes the board, and refuses a second accept into that role", async () => {
    const f = fake({ boards, requests: [open({ wantTank: 1, wantDps: 1 })] });
    await signUpForPug(f.db, person, allowAll, now);
    await signUpForPug(f.db, { ...person, discordUserId: "u2", characterName: "Bobth" }, allowAll, now);
    await signUpForPug(f.db, { ...person, discordUserId: "u3", characterName: "Cara", role: "DPS" }, allowAll, now);
    expect(noticeDelays(f).at(-1)?.data.nextAttemptAt).toEqual(new Date(now.getTime() + 20_000));

    expect(await decidePugSignup(f.db, "s1", "g1", true, allowAll, now)).toBe("accepted");
    expect(f.requests[0]).toMatchObject({ status: "OPEN" });
    expect([...f.jobs.keys()].filter((key) => key.includes("/pug:"))).toEqual(["g2/pug:req1", "g3/pug:req1"]);
    expect(noticeDelays(f).at(-1)?.data.nextAttemptAt).toEqual(now);
    expect([...f.jobs.values()].map((job) => job["kind"]).sort()).toEqual(["PUG_NOTICE", "PUG_POST", "PUG_POST"]);

    await expect(decidePugSignup(f.db, "s2", "g1", true, allowAll, now)).rejects.toThrow("already full");
    expect(f.signups.find((signup) => signup["id"] === "s2")?.["status"]).toBe("PENDING");
    expect(await decidePugSignup(f.db, "s1", "g1", false, allowAll, now)).toBe("already-decided");
    expect(f.signups.find((signup) => signup["id"] === "s1")?.["status"]).toBe("ACCEPTED");
  });

  it("refuses an accept on a closed request, still records a decline, and ignores a second click", async () => {
    const f = fake({ requests: [open({ status: "CLOSED" })] });
    f.signups.push({ id: "s1", requestId: "req1", role: "TANK", status: "PENDING", discordUserId: "u1" });
    await expect(decidePugSignup(f.db, "s1", "g1", true, allowAll, now)).rejects.toThrow("closed");
    expect(f.signups[0]?.["status"]).toBe("PENDING");
    expect(await decidePugSignup(f.db, "s1", "g1", false, allowAll, now)).toBe("declined");
    expect(f.signups[0]?.["status"]).toBe("DECLINED");
    expect(noticeDelays(f).at(-1)?.data.nextAttemptAt).toEqual(now);
    expect(await decidePugSignup(f.db, "s1", "g1", true, allowAll, now)).toBe("already-decided");
    expect(f.signups[0]?.["status"]).toBe("DECLINED");
  });

  // Regression from #343: both open-spot reads finish before either write. The accept
  // re-checks the accepted count under the request lock, in the same transaction as the update.
  it("does not let two accepts fill the same last spot", async () => {
    const f = fake({ boards, requests: [open({ wantTank: 1, wantHealer: 0, wantDps: 0 })] });
    await signUpForPug(f.db, person, allowAll, now);
    await signUpForPug(f.db, { ...person, discordUserId: "u2", characterName: "Bobth" }, allowAll, now);
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    f.raw.pugSignup.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => {
      const row = f.signups.find((signup) => signup["id"] === where.id);
      if (!row) return null;
      const request = f.requests.find((item) => item["id"] === row["requestId"]);
      const snapshot = f.signups.map((signup) => ({ role: signup["role"], status: signup["status"] }));
      reads += 1;
      if (reads === 1) await bothRead;
      else release();
      return { ...row, request: { ...request, status: "OPEN", signups: snapshot } };
    }) as never);
    const settled = await Promise.allSettled([
      decidePugSignup(f.db, "s1", "g1", true, allowAll, now),
      decidePugSignup(f.db, "s2", "g1", true, allowAll, now)
    ]);
    const accepted = f.signups.filter((signup) => signup["status"] === "ACCEPTED");
    expect(accepted).toHaveLength(1);
    expect(settled.filter((result) => result.status === "fulfilled" && result.value === "accepted")).toHaveLength(1);
  });

  it("counts only accepted PUGs against the spots", () => {
    const counts = openCounts({ wantTank: 1, wantHealer: 2, wantDps: 0 }, [{ role: "TANK", status: "ACCEPTED" }, { role: "HEALER", status: "PENDING" }, { role: "HEALER", status: "DECLINED" }]);
    expect(counts).toEqual({ TANK: 0, HEALER: 2, DPS: 0 });
    expect(isFilled(counts)).toBe(false);
    expect(isFilled({ TANK: 0, HEALER: 0, DPS: 0 })).toBe(true);
  });
});

describe("closing and the expiry sweep", () => {
  const base = { guildId: "g1", edition: "classic-tbc", status: "OPEN", scheduledAt: later, createdAt: now, raidTitle: "Karazhan" };

  it("closing is a one-time transition and queues removal of every post", async () => {
    const f = fake({ boards, requests: [{ id: "req1", raidId: "r1", expiresAt: later, ...base }] });
    f.posts.push({ id: "p1", requestId: "req1", guildId: "g2", channelId: "c2", createdAt: now, removedAt: null });
    expect(await closePugRequest(f.db, "req1", "officer", allowAll, now)).toBe(true);
    expect(await closePugRequest(f.db, "req1", "officer", allowAll, now)).toBe(false);
    expect(f.requests[0]).toMatchObject({ status: "CLOSED", closeReason: "officer" });
    expect(f.jobs.has("g2/pug:req1")).toBe(true);
  });

  it("refreshes the officer notice immediately when a request that already has one closes", async () => {
    const f = fake({ boards, requests: [{ id: "req1", raidId: "r1", expiresAt: later, noticeMessageId: "notice-1", ...base }] });
    expect(await closePugRequest(f.db, "req1", "filled", allowAll, now)).toBe(true);
    expect(f.jobs.has("g1/pugnotice:req1")).toBe(true);
    const calls = f.raw.discordJob.updateMany.mock.calls as unknown as [{ where: { id: string }; data: { nextAttemptAt: Date } }][];
    const notice = calls.map((call) => call[0]).find((call) => call.where.id.includes("pugnotice"));
    expect(notice?.data.nextAttemptAt).toEqual(now);
  });

  it("closes when the raid starts, is cancelled or deleted, or the request expires (max 48 hours)", async () => {
    const sweep = async (raid: Row | null, request: Row) => {
      const f = fake({ boards, raid, requests: [{ id: "req1", raidId: "r1", expiresAt: later, ...base, ...request }] });
      f.raw.pugPost.findMany.mockResolvedValue([]);
      f.raw.pugBoardGuild.findMany.mockResolvedValue([]);
      await sweepPugRequests(f.db, allowAll, now);
      return f.requests[0]!;
    };
    expect(await sweep({ status: "PLANNED", scheduledAt: new Date(now.getTime() - 1), title: "Karazhan" }, {})).toMatchObject({ closeReason: "raid-started" });
    expect(await sweep({ status: "CANCELLED", scheduledAt: later, title: "Karazhan" }, {})).toMatchObject({ closeReason: "raid-gone" });
    expect(await sweep(null, {})).toMatchObject({ closeReason: "raid-gone" });
    expect(await sweep({ status: "PLANNED", scheduledAt: later, title: "Karazhan" }, { expiresAt: new Date(now.getTime() - 1) })).toMatchObject({ closeReason: "expired" });
    expect(await sweep({ status: "PLANNED", scheduledAt: new Date(now.getTime() + 9 * 86_400_000), title: "Karazhan" }, { scheduledAt: new Date(now.getTime() + 9 * 86_400_000), expiresAt: new Date(now.getTime() + 8 * 86_400_000), createdAt: new Date(now.getTime() - 49 * 3_600_000) })).toMatchObject({ closeReason: "expired" });
    expect(await sweep({ status: "PLANNED", scheduledAt: later, title: "Karazhan" }, {})).toMatchObject({ status: "OPEN" });
  });

  it("re-queues removal for orphaned posts of closed requests and of guilds that left, without touching live ones", async () => {
    const f = fake({ requests: [] });
    f.raw.pugRequest.findMany.mockResolvedValue([]);
    f.raw.pugPost.findMany
      .mockResolvedValueOnce([{ requestId: "old", guildId: "g2" }]) // posts of closed requests
      .mockResolvedValueOnce([{ requestId: "live", guildId: "g9" }, { requestId: "live2", guildId: "g3" }]); // posts of open requests
    f.raw.pugBoardGuild.findMany.mockResolvedValue([{ guildId: "g3" } as never]); // g9 left the board
    const result = await sweepPugRequests(f.db, allowAll, now);
    expect(result.orphans).toBe(2);
    expect([...f.jobs.keys()].sort()).toEqual(["g2/pug:old", "g9/pug:live"]);
  });
});

describe("website view", () => {
  it("lists open requests for the edition without internal ids or sign-up details", async () => {
    const db = { pugRequest: { findMany: vi.fn().mockResolvedValue([
      { id: "req1", guildId: "g1", createdBy: "officer-secret", raidId: "r1", raidTitle: "Karazhan", scheduledAt: later, expiresAt: later, edition: "classic-tbc", note: "flasks", wantTank: 1, wantHealer: 0, wantDps: 0, guild: { name: "Alpha", discordId: "d1" }, signups: [] },
      { id: "req2", guildId: "g2", createdBy: "x", raidId: "r2", raidTitle: "Full", scheduledAt: later, expiresAt: later, edition: "classic-tbc", note: null, wantTank: 1, wantHealer: 0, wantDps: 0, guild: { name: "Beta", discordId: "d2" }, signups: [{ role: "TANK", status: "ACCEPTED" }] },
      { id: "req3", guildId: "g3", createdBy: "x", raidId: "r3", raidTitle: "Unserved", scheduledAt: later, expiresAt: later, edition: "classic-tbc", note: null, wantTank: 1, wantHealer: 0, wantDps: 0, guild: { name: "Gamma", discordId: "d3" }, signups: [] }
    ]) } };
    const rows = await publicPugRequests(db as never, "classic-tbc", id => id !== "d3", now);
    expect(rows.map(r => r.id)).toEqual(["req1"]); // filled and unserved ones are hidden
    expect(JSON.stringify(rows)).not.toMatch(/officer-secret|"g1"|"r1"|discordUserId/);
    expect(db.pugRequest.findMany.mock.calls[0]![0].where).toMatchObject({ status: "OPEN", edition: "classic-tbc" });
  });

  it("lets a signed-in player sign up and tells them an officer still has to accept or decline", async () => {
    const f = fake({ requests: [{ id: "req1", guildId: "g1", raidId: "r1", edition: "classic-tbc", status: "OPEN", scheduledAt: later, expiresAt: later, wantTank: 1, wantHealer: 0, wantDps: 1, createdBy: "officer" }] });
    const { route } = createPugWeb(f.db, allowAll);
    const kit = { page: (_status: number, title: string, body: string) => ({ title, body }), signInPrompt: () => ({ title: "sign-in", body: "" }) };
    const ctx = {
      request: { method: "POST", path: "/recruitment/pugs" }, lang: "en", t: (en: string) => en, now,
      account: { discordUserId: "u9", username: "pat", displayName: "Pat" }, csrf: "csrf",
      form: new URLSearchParams({ request: "req1", role: "TANK", character: "Patmage", class: "Mage" })
    };
    const signedOut = await route({ ...ctx, account: null } as never, kit as never);
    expect(signedOut).toMatchObject({ title: "sign-in" });
    expect(f.signups).toHaveLength(0);
    const page = await route(ctx as never, kit as never) as { body: string };
    expect(page.body).toContain("officers will accept or decline");
    expect(page.body).not.toContain("pugb:ok");
    expect(page.body).not.toContain("pugb:no");
    expect(f.signups).toEqual([expect.objectContaining({ discordUserId: "u9", characterName: "Patmage", status: "PENDING", role: "TANK" })]);
  });
});

describe("live-test regressions", () => {
  it("a guild that joins late gets the requests that are already open for its edition", async () => {
    const f = fake({ boards: boards.slice(0, 1), requests: [{ id: "open1", guildId: "g1", status: "OPEN", edition: "classic-tbc" }, { id: "other", guildId: "g1", status: "OPEN", edition: "retail" }] });
    await joinPugBoard(f.db, "g2", "c2", "officer", allowAll);
    expect(f.posts.map(p => `${p.requestId}/${p.guildId}`)).toEqual(["open1/g2"]);
  });

  it("joining again does not re-fan-out (channel change only)", async () => {
    const f = fake({ boards: boards.slice(0, 2), requests: [{ id: "open1", guildId: "g1", status: "OPEN", edition: "classic-tbc" }] });
    await joinPugBoard(f.db, "g2", "c9", "officer", allowAll);
    expect(f.posts).toHaveLength(0);
  });

  it("unblocking brings back the post that blocking retired", async () => {
    const f = fake({ boards, blocks: [{ guildId: "g2", blockedGuildId: "g1" }], requests: [{ id: "open1", guildId: "g1", status: "OPEN", edition: "classic-tbc" }] });
    f.posts.push({ id: "p1", requestId: "open1", guildId: "g2", channelId: "c2", messageId: "m1", removedAt: new Date(), createdAt: now });
    expect(await unblockPugGuild(f.db, "g2", "g1", allowAll)).toBe(true);
    expect(f.posts[0]).toMatchObject({ removedAt: null, messageId: null });
    expect(f.jobs.has("g2/pug:open1")).toBe(true);
  });
});
