import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_PER_RUN, HOUR, LIFETIME_MAX_REMINDERS, MAX_ATTEMPTS, SPACING_MS, autoDue, deliverGameReminder, gameRoleIds, listNoGame, manualBlock, queueManualReminders,
  reminderMessage, remindAllBlockedUntil, runAutoGameReminders, stopReminders, type ReminderState
} from "../src/services/game-reminder.js";
import { renderList } from "../src/commands/game-reminders.js";

// An in-memory stand-in for the two tables the service touches.
function fakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const jobs = new Map<string, Record<string, unknown>>();
  const key = (where: { guildId: string; discordUserId: string }) => `${where.guildId}:${where.discordUserId}`;
  const db = {
    rows, jobs,
    memberOnboarding: {
      findUnique: vi.fn(async ({ where }: { where: { guildId_discordUserId: { guildId: string; discordUserId: string } } }) => rows.get(key(where.guildId_discordUserId)) ?? null),
      findMany: vi.fn(async ({ where }: { where: { guildId: string; discordUserId: { in: string[] } } }) =>
        where.discordUserId.in.map((id) => rows.get(`${where.guildId}:${id}`)).filter(Boolean)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const k = key(data as never);
        if (rows.has(k)) throw new Error("unique");
        rows.set(k, { remindersStopped: false, reminderCount: 0, dmClosedAt: null, lastSentAt: null, rulesAcceptedAt: null, ...data });
        return rows.get(k);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = rows.get(key(where as never));
        if (!row) return { count: 0 };
        // The same filters the database applies: equality, and { equals, lt }.
        for (const field of ["reminderCount", "remindersStopped"]) {
          const want = where[field];
          if (want === undefined) continue;
          const have = row[field] as number;
          if (typeof want === "object" && want !== null) {
            const f = want as { equals?: number; lt?: number };
            if ((f.equals !== undefined && have !== f.equals) || (f.lt !== undefined && !(have < f.lt))) return { count: 0 };
          } else if (have !== want) return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { guildId_discordUserId: { guildId: string; discordUserId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = key(where.guildId_discordUserId);
        rows.set(k, rows.has(k) ? { ...rows.get(k), ...update } : { remindersStopped: false, reminderCount: 0, ...create });
      })
    },
    discordJob: {
      upsert: vi.fn(async ({ where, create }: { where: { guildId_key: { guildId: string; key: string } }; create: Record<string, unknown> }) => {
        if (!jobs.has(where.guildId_key.key)) jobs.set(where.guildId_key.key, { ...create, createdAt: new Date() });
      })
    }
  };
  return db;
}

const role = (id: string, name: string, permissions = 0n, managed = false) => ({ id, name, managed, permissions: { bitfield: permissions } });
const settings = { welcomeRoleIds: ["wow", "poe"], inviteWowRoleId: null, rulesChannelId: "rules", gameReminderAuto: true, language: "en", welcomeChannelId: "welcome" } as never;
const now = new Date("2026-11-12T12:00:00Z");

function fakeMember(id: string, held: string[], hoursAgo: number, extra: Record<string, unknown> = {}) {
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    id, displayName: `Name ${id}`, user: { id, username: id, bot: false }, joinedTimestamp: now.getTime() - hoursAgo * HOUR,
    roles: { cache: { has: (r: string) => held.includes(r) } }, send, ...extra
  };
}

function fakeGuild(members: ReturnType<typeof fakeMember>[], roles = [role("wow", "World of Warcraft"), role("poe", "Path of Exile 2"), role("admin", "Mod", 1n << 3n)]) {
  return {
    id: "g1", name: "Quebec Gold", memberCount: members.length,
    roles: { cache: new Map(roles.map((r) => [r.id, r])) },
    members: {
      cache: new Map(members.map((m) => [m.id, m])),
      fetch: vi.fn(async (arg?: string) => arg ? members.find((m) => m.id === arg) ?? Promise.reject(new Error("unknown")) : new Map(members.map((m) => [m.id, m])))
    }
  } as never;
}

const clientOf = (guild: { id: string }) => ({ guilds: { cache: new Map([[guild.id, guild]]) } }) as never;
const guildFor = (s: unknown = settings) => async () => ({ id: "db1", settings: s as never });
const allowed = () => true;

let db: ReturnType<typeof fakeDb>;
beforeEach(() => { db = fakeDb(); });

describe("game roles and the officer list", () => {
  it("reads the game roles from the server's settings, never from fixed names, and keeps flagged ones", () => {
    const guild = fakeGuild([]);
    // A flagged role still counts as "has a game": flagging only limits what the bot hands out.
    expect(gameRoleIds({ welcomeRoleIds: ["wow", "poe", "admin", "gone"], inviteWowRoleId: null } as never, guild).sort()).toEqual(["admin", "poe", "wow"]);
    expect(gameRoleIds({ welcomeRoleIds: [], inviteWowRoleId: null } as never, guild)).toEqual([]);
    const custom = fakeGuild([], [role("d4", "Diablo IV"), role("lol", "League")]);
    expect(gameRoleIds({ welcomeRoleIds: ["d4", "lol"], inviteWowRoleId: null } as never, custom).sort()).toEqual(["d4", "lol"]);
  });

  it("lists members with no game role, newest first, without bots or members who picked", async () => {
    const guild = fakeGuild([
      fakeMember("old", [], 500), fakeMember("new", [], 3), fakeMember("picked", ["poe"], 40),
      fakeMember("bot", [], 10, { user: { id: "bot", username: "bot", bot: true } })
    ]);
    db.rows.set("db1:old", { guildId: "db1", discordUserId: "old", rulesAcceptedAt: now, reminderCount: 1, lastSentAt: now, remindersStopped: false, dmClosedAt: null });
    const listed = await listNoGame(db as never, "db1", guild, settings);
    expect(listed!.rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(listed!.rows[1]).toMatchObject({ rulesAccepted: true, reminders: 1, stopped: false });
    expect(listed!.rows[0]).toMatchObject({ rulesAccepted: false, reminders: 0 });
  });

  it("reports an unconfigured server and pages ten at a time", async () => {
    expect((await listNoGame(db as never, "db1", fakeGuild([fakeMember("a", [], 1)]), { ...(settings as object), welcomeRoleIds: [] } as never))!.configured).toBe(false);
    const rows = Array.from({ length: 23 }, (_, i) => ({ id: `u${i}`, name: `n${i}`, joinedAt: now, rulesAccepted: null, reminders: 0, lastSentAt: null, stopped: false, dmClosed: false }));
    const page3 = renderList("en", rows, 3);
    expect(page3.pages).toBe(3);
    expect(page3.slice).toHaveLength(3);
    expect(page3.content).toContain("23");
    expect(renderList("fr", rows, 99).page).toBe(3);
  });
});

describe("manual reminders", () => {
  it("queues one job per member, records it first, and skips stopped, closed, recent, picked and bots", async () => {
    const guild = fakeGuild([fakeMember("a", [], 80), fakeMember("stopped", [], 80), fakeMember("closed", [], 80), fakeMember("recent", [], 80), fakeMember("picked", ["wow"], 80), fakeMember("bot", [], 80, { user: { id: "bot", username: "bot", bot: true } })]);
    db.rows.set("db1:stopped", { reminderCount: 0, remindersStopped: true });
    db.rows.set("db1:closed", { reminderCount: 1, remindersStopped: false, dmClosedAt: now });
    db.rows.set("db1:recent", { reminderCount: 1, remindersStopped: false, lastReminderAt: new Date(now.getTime() - 2 * HOUR) });
    const result = await queueManualReminders(db as never, "db1", guild, settings, ["a", "stopped", "closed", "recent", "picked", "bot"], now);
    expect(result).toEqual({ queued: 1, stopped: 1, dmClosed: 1, recent: 1, gone: 2, capped: 0 });
    expect([...db.jobs.keys()]).toEqual(["game-reminder:a:1"]);
    expect(db.rows.get("db1:a")).toMatchObject({ reminderCount: 1, lastReminderSource: "OFFICER" });
  });

  it("two clicks at once queue one reminder", async () => {
    const guild = fakeGuild([fakeMember("a", [], 80)]);
    const [one, two] = await Promise.all([
      queueManualReminders(db as never, "db1", guild, settings, ["a"], now),
      queueManualReminders(db as never, "db1", guild, settings, ["a"], now)
    ]);
    expect(one.queued + two.queued).toBe(1);
    expect(db.jobs.size).toBe(1);
  });
});

describe("caps, cooldown and pacing", () => {
  it("a member is reminded at most the lifetime cap across officer and automatic sends, whatever the day", async () => {
    const guild = fakeGuild([fakeMember("a", [], 80)]);
    let at = now;
    for (let i = 0; i < LIFETIME_MAX_REMINDERS + 2; i += 1) {
      await queueManualReminders(db as never, "db1", guild, settings, ["a"], at);
      at = new Date(at.getTime() + 2 * 24 * HOUR);
    }
    expect(db.rows.get("db1:a")!["reminderCount"]).toBe(LIFETIME_MAX_REMINDERS);
    expect(db.jobs.size).toBe(LIFETIME_MAX_REMINDERS);
    const last = await queueManualReminders(db as never, "db1", guild, settings, ["a"], at);
    expect(last).toMatchObject({ queued: 0, capped: 1 });
  });

  it("the database filter refuses an automatic reminder past its cap even when the read was stale", async () => {
    // Two reminders already saved, but this run read the member as having none.
    db.rows.set("db1:a", { reminderCount: 2, remindersStopped: false, lastReminderSource: "AUTO", lastReminderAt: new Date(0), lastSentAt: new Date(0), dmClosedAt: null });
    const stale = { reminderCount: 0, lastReminderAt: null };
    const real = db.memberOnboarding.findUnique;
    db.memberOnboarding.findUnique = vi.fn(async () => ({ ...db.rows.get("db1:a"), ...stale })) as never;
    const guild = fakeGuild([fakeMember("a", [], 30)]);
    expect(await runAutoGameReminders(clientOf(guild as never), db as never, guildFor(), allowed, now)).toBe(0);
    db.memberOnboarding.findUnique = real;
    expect(db.jobs.size).toBe(0);
  });

  it("remind all can be used once a week per server", () => {
    expect(remindAllBlockedUntil(null, now)).toBeNull();
    expect(remindAllBlockedUntil(new Date(now.getTime() - 6 * 24 * HOUR), now)).toBeInstanceOf(Date);
    expect(remindAllBlockedUntil(new Date(now.getTime() - 8 * 24 * HOUR), now)).toBeNull();
  });

  it("spreads a big batch into slots so other job types interleave", async () => {
    const members = Array.from({ length: 300 }, (_, i) => fakeMember(`u${i}`, [], 80));
    const result = await queueManualReminders(db as never, "db1", fakeGuild(members), settings, members.map((m) => m.id), now);
    expect(result.queued).toBe(300);
    const due = [...db.jobs.values()].map((j) => (j["nextAttemptAt"] as Date).getTime() - now.getTime());
    expect(Math.min(...due)).toBe(0);
    expect(Math.max(...due)).toBe(299 * SPACING_MS);
    // At most a handful are due in any one minute: the queue's batch of 25 is never filled by this job.
    const inFirstMinute = due.filter((d) => d < 60_000).length;
    expect(inFirstMinute).toBeLessThanOrEqual(10);
  });

  it("gives a failing reminder up after the attempt limit instead of retrying for ever", async () => {
    db.rows.set("db1:b", { reminderCount: 1, remindersStopped: false, lastSentAt: null, dmClosedAt: null });
    const broken = fakeMember("b", [], 30, { send: vi.fn().mockRejectedValue(Object.assign(new Error("down"), { code: 500 })) });
    const job = (attempts: number) => ({ guildId: "db1", createdAt: new Date(now.getTime() - 1000), attempts, payload: { discordUserId: "b", source: "OFFICER", n: 1 } }) as never;
    await expect(deliverGameReminder(fakeGuild([broken]), db as never, settings, job(MAX_ATTEMPTS - 1))).rejects.toThrow("down");
    expect(await deliverGameReminder(fakeGuild([broken]), db as never, settings, job(MAX_ATTEMPTS))).toBe("failed");
    expect(db.rows.get("db1:b")!["dmClosedAt"]).toBeInstanceOf(Date);
  });
});

describe("automatic schedule", () => {
  const state = (extra: Partial<ReminderState>): ReminderState => ({ reminderCount: 0, lastReminderAt: null, lastReminderSource: null, lastSentAt: null, remindersStopped: false, dmClosedAt: null, rulesAcceptedAt: null, ...extra });

  it("sends the first after 24 h, only inside the 72 h window, and the second a week after the first", () => {
    expect(autoDue(null, 23 * HOUR, now)).toBe(false);
    expect(autoDue(null, 25 * HOUR, now)).toBe(true);
    expect(autoDue(null, 100 * HOUR, now)).toBe(false);
    const first = state({ reminderCount: 1, lastReminderSource: "AUTO", lastReminderAt: new Date(now.getTime() - 6 * 24 * HOUR), lastSentAt: now });
    expect(autoDue(first, 10 * 24 * HOUR, now)).toBe(false);
    const week = state({ reminderCount: 1, lastReminderSource: "AUTO", lastReminderAt: new Date(now.getTime() - 7 * 24 * HOUR), lastSentAt: now });
    expect(autoDue(week, 9 * 24 * HOUR, now)).toBe(true);
    // Never a third, never after an officer's first, never when the first was not delivered.
    expect(autoDue({ ...week, reminderCount: 2 }, 9 * 24 * HOUR, now)).toBe(false);
    expect(autoDue({ ...week, lastReminderSource: "OFFICER" }, 9 * 24 * HOUR, now)).toBe(false);
    expect(autoDue({ ...week, lastSentAt: null }, 9 * 24 * HOUR, now)).toBe(false);
    expect(autoDue({ ...week, remindersStopped: true }, 9 * 24 * HOUR, now)).toBe(false);
    expect(autoDue({ ...week, dmClosedAt: now }, 9 * 24 * HOUR, now)).toBe(false);
  });

  it("does nothing while the server's switch is off, and does nothing when no game role is configured", async () => {
    const guild = fakeGuild([fakeMember("a", [], 30)]);
    expect(await runAutoGameReminders(clientOf(guild as never), db as never, guildFor({ ...(settings as object), gameReminderAuto: false }), allowed, now)).toBe(0);
    expect(await runAutoGameReminders(clientOf(guild as never), db as never, guildFor({ ...(settings as object), welcomeRoleIds: [] }), allowed, now)).toBe(0);
    expect(db.jobs.size).toBe(0);
  });

  it("queues the first reminder once, then the second a week later, then never again, even across restarts", async () => {
    const guild = fakeGuild([fakeMember("a", [], 30), fakeMember("old", [], 300), fakeMember("picked", ["wow"], 30), fakeMember("fresh", [], 2)]);
    const client = clientOf(guild as never);
    expect(await runAutoGameReminders(client, db as never, guildFor(), allowed, now)).toBe(1);
    expect([...db.jobs.keys()]).toEqual(["game-reminder:a:1"]);
    // A restart reads the saved count: nothing more the same hour.
    expect(await runAutoGameReminders(client, db as never, guildFor(), allowed, now)).toBe(0);
    // The first was delivered; a week later the second is queued.
    db.rows.get("db1:a")!["lastSentAt"] = now;
    const weekLater = new Date(now.getTime() + 7 * 24 * HOUR);
    (guild as unknown as { members: { cache: Map<string, { joinedTimestamp: number }> } }).members.cache.get("a")!.joinedTimestamp = now.getTime() - 30 * HOUR;
    expect(await runAutoGameReminders(client, db as never, guildFor(), allowed, weekLater)).toBe(1);
    expect([...db.jobs.keys()]).toContain("game-reminder:a:2");
    // And never a third.
    db.rows.get("db1:a")!["lastSentAt"] = weekLater;
    expect(await runAutoGameReminders(client, db as never, guildFor(), allowed, new Date(weekLater.getTime() + 8 * 24 * HOUR))).toBe(0);
    expect(db.rows.get("db1:a")!["reminderCount"]).toBe(2);
  });

  it("queues at most a batch per run", async () => {
    const members = Array.from({ length: AUTO_PER_RUN + 10 }, (_, i) => fakeMember(`u${i}`, [], 30));
    expect(await runAutoGameReminders(clientOf(fakeGuild(members) as never), db as never, guildFor(), allowed, now)).toBe(AUTO_PER_RUN);
  });

  it("skips servers the hosted pilot does not allow", async () => {
    const guild = fakeGuild([fakeMember("a", [], 30)]);
    expect(await runAutoGameReminders(clientOf(guild as never), db as never, guildFor(), () => false, now)).toBe(0);
  });
});

describe("delivery", () => {
  const job = (extra: Record<string, unknown> = {}) => ({ guildId: "db1", attempts: 1, createdAt: new Date(now.getTime() - 1000), payload: { discordUserId: "a", source: "OFFICER", n: 1 }, ...extra }) as never;

  it("sends a private message with the picker button, a link to the server and a stop button, in the server's language", async () => {
    const member = fakeMember("a", [], 30);
    expect(await deliverGameReminder(fakeGuild([member]), db as never, settings, job())).toBe("sent");
    const message = member.send.mock.calls[0]![0];
    const ids = (message.components[0].toJSON() as { components: { custom_id?: string; url?: string }[] }).components;
    expect(ids.map((c) => c.custom_id ?? c.url)).toEqual(["onboard:games:g1", "https://discord.com/channels/g1/welcome", "onboard:stop:g1"]);
    expect(message.content).toContain("Quebec Gold");
    const french = reminderMessage({ welcomeChannelId: null, language: "fr" } as never, { id: "g1", name: "QG" }, 2);
    expect(french.content).toContain("Re-salut");
    expect(french.components[0]!.components).toHaveLength(2);
    expect(db.rows.get("db1:a")).toBeUndefined();
  });

  it("marks closed DMs and never retries them; other errors throw so the queue retries", async () => {
    db.rows.set("db1:a", { reminderCount: 1, remindersStopped: false, lastSentAt: null, dmClosedAt: null });
    const closed = fakeMember("a", [], 30, { send: vi.fn().mockRejectedValue(Object.assign(new Error("Cannot send"), { code: 50007 })) });
    expect(await deliverGameReminder(fakeGuild([closed]), db as never, settings, job())).toBe("dmClosed");
    expect(db.rows.get("db1:a")!["dmClosedAt"]).toBeInstanceOf(Date);
    expect(await deliverGameReminder(fakeGuild([closed]), db as never, settings, job())).toBe("skipped");
    expect(closed.send).toHaveBeenCalledTimes(1);
    db.rows.set("db1:b", { reminderCount: 1, remindersStopped: false, lastSentAt: null, dmClosedAt: null });
    const broken = fakeMember("b", [], 30, { send: vi.fn().mockRejectedValue(Object.assign(new Error("down"), { code: 500 })) });
    await expect(deliverGameReminder(fakeGuild([broken]), db as never, settings, job({ payload: { discordUserId: "b", source: "OFFICER", n: 1 } }))).rejects.toThrow("down");
  });

  it("re-checks at delivery: picked a game, stopped, bot, left, automatic switched off, or already delivered", async () => {
    const picked = fakeMember("a", ["wow"], 30);
    expect(await deliverGameReminder(fakeGuild([picked]), db as never, settings, job())).toBe("skipped");
    expect(picked.send).not.toHaveBeenCalled();
    db.rows.set("db1:b", { remindersStopped: true });
    const stopped = fakeMember("b", [], 30);
    expect(await deliverGameReminder(fakeGuild([stopped]), db as never, settings, job({ payload: { discordUserId: "b", source: "OFFICER", n: 1 } }))).toBe("skipped");
    expect(stopped.send).not.toHaveBeenCalled();
    expect(await deliverGameReminder(fakeGuild([]), db as never, settings, job())).toBe("skipped");
    const auto = fakeMember("a", [], 30);
    expect(await deliverGameReminder(fakeGuild([auto]), db as never, { ...(settings as object), gameReminderAuto: false } as never, job({ payload: { discordUserId: "a", source: "AUTO", n: 1 } }))).toBe("skipped");
    db.rows.set("db1:c", { remindersStopped: false, lastSentAt: now });
    const done = fakeMember("c", [], 30);
    expect(await deliverGameReminder(fakeGuild([done]), db as never, settings, job({ payload: { discordUserId: "c", source: "OFFICER", n: 1 } }))).toBe("skipped");
    expect(done.send).not.toHaveBeenCalled();
  });

  it("sends only once even when the job runs twice after a restart", async () => {
    db.rows.set("db1:a", { reminderCount: 1, remindersStopped: false, lastSentAt: null, dmClosedAt: null });
    const member = fakeMember("a", [], 30);
    const guild = fakeGuild([member]);
    expect(await deliverGameReminder(guild, db as never, settings, job())).toBe("sent");
    expect(await deliverGameReminder(guild, db as never, settings, job())).toBe("skipped");
    expect(member.send).toHaveBeenCalledTimes(1);
  });
});

describe("stop button", () => {
  it("is remembered and ends manual and automatic reminders", async () => {
    await stopReminders(db as never, "db1", "a");
    expect(db.rows.get("db1:a")).toMatchObject({ remindersStopped: true });
    expect(manualBlock({ stopped: true, dmClosed: false }, null, now)).toBe("stopped");
    expect(autoDue(db.rows.get("db1:a") as never, 30 * HOUR, now)).toBe(false);
    const guild = fakeGuild([fakeMember("a", [], 30)]);
    expect((await queueManualReminders(db as never, "db1", guild, settings, ["a"], now)).stopped).toBe(1);
    expect(await runAutoGameReminders(clientOf(guild as never), db as never, guildFor(), allowed, now)).toBe(0);
  });
});
