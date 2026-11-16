/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { exportProbes, sanitizeProbes } from "../companion/probes-content.mjs";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { addonSnapshotSchema } from "../src/integrations/addon.js";
import { deviceUploadSchema } from "../src/services/companion-device.js";
import { latestClientProbes, probeDetail, storeClientProbes } from "../src/services/client-probes.js";
import { executeOwnerProbes, ownerProbesCommand } from "../src/commands/owner-probes.js";

// Client probes (/guilded probe ...) travel from the saved file to the bot owner: sanitized by the companion, stored latest-per-build,
// readable only by the bot owner. Old bots and old companions ignore / omit the optional section.

const auctions = {
  at: 1_800_000_000, build: 66666, logins: 1,
  fn: { GetInboxHeaderInfo: true, GetMoney: false },
  globals: { ERR_AUCTION_SOLD_S: "Your auction of %s has sold.", AUCTION_SOLD_MAIL_SUBJECT: "Auction successful: %s" },
  inbox: { mails: 2, subject: "Auction successful: Linen Cloth", invoiceTypes: { seller: 1 } },
  owned: { count: 1, buyoutAmount: 5000, moneyHeld: 12, copper: 7, itemLink: "|cffffffff|Hitem:1|h[Linen]|h", name: "Linen" },
  stats: ["328|Total gold acquired|value"],
  note: "x".repeat(300)
};

describe("probe export (companion)", () => {
  it("keeps shapes, ids and counts and drops long strings and amount, money, copper, name, subject and link fields", () => {
    const out = sanitizeProbes({ auctions }) as unknown as { auctions: any };
    expect(out.auctions.fn).toEqual({ GetInboxHeaderInfo: true, GetMoney: false });
    expect(out.auctions.inbox).toEqual({ mails: 2, invoiceTypes: { seller: 1 } });
    expect(out.auctions.owned).toEqual({ count: 1 });
    expect(out.auctions.note).toBeUndefined();
    expect(out.auctions.globals.ERR_AUCTION_SOLD_S).toBe("Your auction of %s has sold.");
    expect(out.auctions.globals.AUCTION_SOLD_MAIL_SUBJECT).toBe("Auction successful: %s");
    expect(JSON.stringify(out)).not.toMatch(/Linen|5000|cffffff/);
    expect(out.auctions.stats).toEqual(["328|Total gold acquired|value"]);
  });

  it("is part of the export only when the saved file holds probes, and ignores junk", () => {
    expect(exportProbes({})).toBeUndefined();
    expect(exportProbes({ probes: { commAuto: true, Bad_Kind: { a: 1 }, maps: [1] } })).toBeUndefined();
    expect(exportProbes({ probes: { maps: { build: 1, rows: ["10|Eastern Kingdoms"] } } })).toEqual({ maps: { build: 1, rows: ["10|Eastern Kingdoms"] } });
  });

  it("goes in the unsigned upload body, and an upload without probes has none", () => {
    const full = { wowGuild: "Quebec Gold|Forever", character: { name: "Kev", realm: "Forever" }, probes: { maps: { build: 1, rows: ["a"] } } };
    expect((deviceUploadBody(full, {}) as { probes?: unknown }).probes).toEqual({ maps: { build: 1, rows: ["a"] } });
    expect((deviceUploadBody({ ...full, probes: undefined }, {}) as { probes?: unknown }).probes).toBeUndefined();
  });
});

describe("old and new wire shapes", () => {
  it("accepts the optional section in both schemas and still accepts uploads without it", () => {
    expect(deviceUploadSchema.safeParse({ guild: null, characters: [], probes: { maps: { build: 1 } } }).success).toBe(true);
    expect(deviceUploadSchema.safeParse({ guild: null, characters: [] }).success).toBe(true);
    const withProbes = addonSnapshotSchema.safeParse({ addonVersion: "9", character: { name: "Kev", realm: "Forever", class: "WARRIOR", level: 60 }, probes: { maps: { build: 1 } } });
    const without = addonSnapshotSchema.safeParse({ addonVersion: "9", character: { name: "Kev", realm: "Forever", class: "WARRIOR", level: 60 } });
    expect(withProbes.success).toBe(without.success);
  });
});

function fakeStore() {
  const rows = new Map<string, any>();
  const k = (w: any) => `${w.kind_build_edition.kind}|${w.kind_build_edition.build}|${w.kind_build_edition.edition}`;
  return { rows, store: { clientProbe: {
    findUnique: async ({ where }: any) => rows.get(k(where)) ?? null,
    count: async ({ where }: any) => [...rows.values()].filter((r) => r.kind === where.kind).length,
    upsert: async ({ where, create, update }: any) => { const old = rows.get(k(where)); rows.set(k(where), { ...(old ?? create), ...(old ? update : {}), updatedAt: new Date() }); },
    findMany: async ({ where }: any) => [...rows.values()].filter((r) => !where.kind || r.kind === where.kind).sort((a, b) => b.updatedAt - a.updatedAt)
  } } as never };
}

describe("probe storage (bot)", () => {
  it("keeps the latest probe per kind and client build, and a stale one never replaces a newer one", async () => {
    const { rows, store } = fakeStore();
    expect(await storeClientProbes(store, { auctions, maps: { at: 1_800_000_100, build: 66666, rows: ["1|x"] } }, "9.3.5")).toBe(2);
    expect(await storeClientProbes(store, { auctions: { ...auctions, at: 1_800_000_500, inbox: { mails: 9 } } })).toBe(1);
    expect(await storeClientProbes(store, { auctions: { ...auctions, at: 1_700_000_000, inbox: { mails: 1 } } })).toBe(0);
    expect(await storeClientProbes(store, { auctions: { ...auctions, build: 77777 } })).toBe(1);
    expect(rows.size).toBe(3);
    expect(rows.get("auctions|66666|forever").data.inbox.mails).toBe(9);
    expect(rows.get("auctions|66666|forever").data.owned).toEqual({ count: 1 });
    const latest = await latestClientProbes(store, "auctions");
    expect(latest.map((row) => row.build).sort()).toEqual(["66666", "77777"]);
    expect(probeDetail(latest[0]!)).toContain("auctions");
  });

  it("sanitizes again on the bot, so a hostile body stores no names or amounts", async () => {
    const { rows, store } = fakeStore();
    await storeClientProbes(store, { maps: { build: 5, name: "Kev", copper: 99, rows: ["a"], blob: "z".repeat(500) } });
    expect(rows.get("maps|5|forever").data).toEqual({ build: 5, rows: ["a"] });
    expect(await storeClientProbes(store, "nonsense")).toBe(0);
  });
});

describe("/guilded-probes", () => {
  const interaction = (userId: string) => {
    const reply = vi.fn(async () => undefined);
    return { reply, value: { user: { id: userId }, client: { application: { fetch: async () => ({ owner: { id: "owner-1" } }) } }, options: { getSubcommand: () => "list" }, reply } };
  };

  it("refuses everyone but the bot owner, and is hidden from non-administrators", async () => {
    const officer = interaction("officer-9");
    await executeOwnerProbes(officer.value as never);
    expect(officer.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Only the Guilded bot's owner") }));
    expect(ownerProbesCommand.toJSON().default_member_permissions).toBe("8");
    expect(ownerProbesCommand.toJSON().options?.map((o) => o.name)).toEqual(["list", "show"]);
  });
});
