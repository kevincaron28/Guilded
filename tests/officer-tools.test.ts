import { describe, expect, it, vi } from "vitest";
import { createDoNotInviteService, dniMatches, dniWarning, type DniEntry } from "../src/services/do-not-invite.js";
import { remindEndedTrials, trialEndedText, type TrialDelivery } from "../src/services/trial-reminders.js";
import { createRaidCoreService, DEFAULT_TRIAL_DAYS } from "../src/services/raid-core.js";

const entry = (over: Partial<DniEntry>): DniEntry => ({ id: "e", name: "Grimbold Ashvane", realm: null, discordUserId: null, reason: "Ninja-looted", addedBy: "1", createdAt: new Date("2026-10-01T00:00:00Z"), ...over });

describe("do-not-invite list", () => {
  it("matches by Discord account, or by character name with the realm when both give one", () => {
    const list = [entry({ id: "a", name: "Grimbold Ashvane" }), entry({ id: "b", name: "Thrall", realm: "Stormrage" }), entry({ id: "c", name: "Nobody", discordUserId: "42" })];
    expect(dniMatches(list, { names: ["grimbold  ASHVANE"] }).map((row) => row.id)).toEqual(["a"]);
    expect(dniMatches(list, { names: ["Thrall-Storm Rage"] }).map((row) => row.id)).toEqual(["b"]);
    expect(dniMatches(list, { names: ["Thrall-Area 52"] })).toEqual([]);
    expect(dniMatches(list, { names: ["Thrall"] }).map((row) => row.id)).toEqual(["b"]);
    expect(dniMatches(list, { discordUserId: "42" }).map((row) => row.id)).toEqual(["c"]);
    expect(dniMatches([entry({ name: "Éloïse" })], { names: ["Eloise"] })).toHaveLength(1);
    expect(dniMatches(list, { discordUserId: "7", names: [] })).toEqual([]);
  });

  it("warns without pinging and says nothing was blocked", () => {
    const text = dniWarning(entry({ realm: "Forever" }), "<@9> (Grimbold Ashvane)", "application");
    expect(text).toContain("applied and matches **Grimbold Ashvane-Forever** — Ninja-looted");
    expect(text).toContain("Nothing was blocked");
  });

  it("refuses an entry without a usable name or reason", async () => {
    const create = vi.fn(async ({ data }) => data);
    const service = createDoNotInviteService({ doNotInvite: { create } } as never);
    await expect(service.add("g", { name: "x", reason: "griefing", addedBy: "1" })).rejects.toThrow(/2 to 60/);
    await expect(service.add("g", { name: "Thrall", reason: "", addedBy: "1" })).rejects.toThrow(/reason/);
    await service.add("g", { name: " Thrall ", realm: " ", reason: " griefing ", addedBy: "1" });
    expect(create.mock.calls[0]![0].data).toMatchObject({ name: "Thrall", realm: null, reason: "griefing" });
  });
});

describe("trial tracking", () => {
  function coreDb() {
    const upsert = vi.fn(async ({ create }) => ({ id: "spot", characterId: null, ...create }));
    return { upsert, db: { raidCoreMember: { upsert, update: vi.fn() }, raidCore: { findUnique: vi.fn(async () => ({ guildId: "g" })) }, guildSettings: { findUnique: vi.fn(async () => null) } } };
  }

  it("a trial records its end and sponsor; approval clears them", async () => {
    const { upsert, db } = coreDb();
    const service = createRaidCoreService(db as never);
    const before = Date.now();
    await service.settleApplicant("c", "m", "TRIAL", "DPS", null, { days: 10, sponsorId: "officer" });
    const terms = upsert.mock.calls[0]![0].update;
    expect(terms.trial).toBe(true);
    expect(terms.trialSponsorId).toBe("officer");
    expect(terms.trialEndsAt.getTime() - terms.trialStartedAt.getTime()).toBe(10 * 86_400_000);
    expect(terms.trialStartedAt.getTime()).toBeGreaterThanOrEqual(before);
    await service.settleApplicant("c", "m", "TRIAL", "DPS", null);
    const fallback = upsert.mock.calls[1]![0].update;
    expect(fallback.trialEndsAt.getTime() - fallback.trialStartedAt.getTime()).toBe(DEFAULT_TRIAL_DAYS * 86_400_000);
    await service.settleApplicant("c", "m", "APPROVED", "DPS", null);
    expect(upsert.mock.calls[2]![0].update).toMatchObject({ trial: false, trialStartedAt: null, trialEndsAt: null, trialSponsorId: null, trialRemindedAt: null });
  });

  it("tells the officer log once per ended trial, and retries a server it couldn't reach", async () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const spot = (id: string, discordId: string) => ({ id, trialStartedAt: new Date("2026-11-06T12:00:00Z"), trialSponsorId: "77", member: { displayName: "Newbie" }, core: { name: "Tuesday MC", guild: { id: "g", discordId } } });
    const findMany = vi.fn(async () => [spot("s1", "reachable"), spot("s2", "offline"), spot("s3", "nolog")]);
    const update = vi.fn(async () => ({}));
    const deliver: TrialDelivery = vi.fn(async (trial) => trial.discordGuildId === "offline" ? "unreachable" : trial.discordGuildId === "nolog" ? "no-channel" : "sent");
    await expect(remindEndedTrials({ raidCoreMember: { findMany, update } } as never, deliver, now)).resolves.toBe(1);
    expect((findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({ trial: true, trialEndsAt: { lte: now }, trialRemindedAt: null });
    expect(update.mock.calls.map((call) => (call as unknown as [{ where: { id: string } }])[0].where.id)).toEqual(["s1", "s3"]);
    expect(trialEndedText({ guildId: "g", discordGuildId: "x", core: "Tuesday MC", member: "Newbie", startedAt: null, sponsorId: "77" }))
      .toBe("⏳ Trial ended: **Newbie** in **Tuesday MC** (sponsor <@77>). Approve or reject them on their application card, or with /mod application approve|reject.");
  });
});
