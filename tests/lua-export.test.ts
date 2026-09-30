import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAddonExport } from "../companion/lua-export.mjs";
import { parseAddonSnapshot, normalizeAddonSnapshot } from "../src/integrations/addon.js";

// WoW's SavedVariables writer always serializes array-like Lua tables with
// explicit bracketed keys (`{ [1] = a, [2] = b }`), never the compact
// `{ a, b }` form — this is what a real client actually writes to disk, not
// just a stylistic choice, so the fixture below intentionally uses that
// syntax throughout instead of the shorthand.
const FIXTURE = `
GuildedDB = {
  version = 3,
  epgp = {
    ["Kevin"] = {
      ep = 10, gp = 0,
      ledger = {
        [1] = { epAmount = 10, gpAmount = 0, type = "EP_AWARD", reason = "Raid attendance", at = "2026-09-24T00:00:00Z", by = "Kevin" },
        [2] = { id = "Kevin-1790000000-7", epAmount = 5, gpAmount = 0, type = "EP_AWARD", reason = "", at = "2026-09-25T00:00:00Z", by = "Kevin" },
      },
    },
  },
  readiness = {
    ["Kevin"] = {
      character = "Kevin", inspectedAt = "2026-09-24T00:00:00Z",
      items = { [1] = { slot = "Head", itemName = "Lionheart Helm", itemId = "16795" } },
      consumables = {},
      professions = { [1] = { name = "Blacksmithing", skillLevel = 225 } },
      findings = { [1] = { code = "GEAR_PRESENT", severity = "INFO", message = "Required gear slots are populated." } },
      status = "READY",
    },
  },
  attunements = {
    ["Kevin"] = {
      ["Onyxia Key"] = { completed = true, at = "2026-09-24T00:00:00Z", by = "Kevin" },
    },
  },
  peerRoster = {
    ["Bob"] = {
      status = "NOT_READY", missing = 1, minDurability = 42,
      professions = "Mining:150,Engineering:120",
      updatedAt = "2026-09-24T00:05:00Z", reportedBy = "Bob",
    },
  },
  loot = {},
  events = {},
  exports = {},
}
`;

describe("readAddonExport (real WoW SavedVariables array syntax)", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "qg-lua-export-"));
    file = join(dir, "Guilded.lua");
    await writeFile(file, FIXTURE, "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("exports complete empty peer professions with the sender's original timestamp", async () => {
    await writeFile(file, 'GuildedDB = { peerRoster = { ["Amy"] = { professions = "", professionsComplete = true, professionsAt = 1800000000, updatedAt = "2026-09-30T10:00:00Z", identity = { class = "MAGE" } } } }');
    const result = parseAddonSnapshot(await readAddonExport(file, "Realm"));
    expect(result.characters[0]).toMatchObject({ name: "Amy", professions: [], professionsComplete: true, professionsAt: new Date(1800000000000) });
    expect(result.readiness[0]).toMatchObject({ character: "Amy", professions: [], professionsComplete: true, professionsAt: new Date(1800000000000) });
  });

  it("decodes bracketed-key Lua arrays as real arrays, not numeric-keyed objects", async () => {
    const result = await readAddonExport(file, "WoW Forever");
    const selfEntry = result.readiness.find((entry: { character: string }) => entry.character === "Kevin");
    expect(Array.isArray(selfEntry?.items)).toBe(true);
    expect(Array.isArray(selfEntry?.findings)).toBe(true);
    expect(Array.isArray(selfEntry?.professions)).toBe(true);
    expect(Array.isArray(selfEntry?.consumables)).toBe(true);
  });

  it("folds peer roster digests into synthesized readiness entries", async () => {
    const result = await readAddonExport(file, "WoW Forever");
    const peerEntry = result.readiness.find((entry: { character: string }) => entry.character === "Bob");
    expect(peerEntry?.professions).toEqual([{ name: "Mining", skillLevel: 150 }, { name: "Engineering", skillLevel: 120 }]);
    expect(peerEntry?.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PEER_MISSING_GEAR" }),
      expect.objectContaining({ code: "PEER_LOW_DURABILITY" })
    ]));
  });

  it("produces output that validates against the bot's addon import schema end to end", async () => {
    const result = await readAddonExport(file, "WoW Forever");
    const snapshot = normalizeAddonSnapshot(parseAddonSnapshot(result));
    expect(snapshot.readiness.map((entry) => entry.character).sort()).toEqual(["Bob", "Kevin"]);
    expect(snapshot.epgpTransactions).toHaveLength(2);
    expect(snapshot.attunements).toHaveLength(1);
  });

  it("gives every ledger entry a ref that stays the same across exports", async () => {
    const first = await readAddonExport(file, "WoW Forever");
    const second = await readAddonExport(file, "WoW Forever");
    const refs = first.epgpTransactions.map((entry: { sourceRef: string }) => entry.sourceRef);
    expect(refs).toEqual(second.epgpTransactions.map((entry: { sourceRef: string }) => entry.sourceRef));
    expect(refs).toEqual(["qg:Kevin:2026-09-24T00:00:00Z:Kevin:0", "qg:Kevin-1790000000-7"]);
    // An empty reason would fail the bot's 3-character minimum.
    expect(first.epgpTransactions[1]?.reason.length).toBeGreaterThanOrEqual(3);
  });

  it("turns a peer's reason flags into readiness findings", async () => {
    const flagged = FIXTURE.replace('["Bob"] = {', '["Cy"] = { status = "PARTIAL", missing = 0, minDurability = 90, professions = "", flags = "NOFLASK,NOFOOD,ENCH:Chest+Legs", updatedAt = "2026-09-24T00:06:00Z", reportedBy = "Cy" }, ["Bob"] = {');
    await writeFile(file, flagged, "utf8");
    const result = await readAddonExport(file, "WoW Forever");
    const peer = result.readiness.find((entry: { character: string }) => entry.character === "Cy");
    expect(peer?.findings.map((finding: { code: string }) => finding.code)).toEqual(["NO_FLASK", "NO_FOOD", "MISSING_ENCHANTS"]);
    expect(peer?.findings[2]?.message).toBe("Missing enchants: Chest, Legs.");
    // And the bot's schema still accepts it.
    expect(() => parseAddonSnapshot(result)).not.toThrow();
  });
});
