import { describe, expect, it, vi } from "vitest";
import { characterTrust, characterTrustMap, T8_STRICT_FROM, trustLabel, trustSuffix } from "../src/services/character-trust.js";
import { charactersMeSection, meCharacterList } from "../src/services/me-characters.js";
import { formatRosterGaps, planRosterGaps } from "../src/services/roster-gaps.js";
import { rosterFreshness } from "../src/services/guild-data.js";

// 9.1 (docs/JEEVES_COMPARISON.md ideas 1 and 3): "reported, not verified" and the roster's freshness.
// Around the instant the strict rule went live (T8_STRICT_FROM, 10 November 2026 15:14 UTC).
const OLD = new Date("2026-11-09T12:00:00Z");
const NEW = new Date("2026-11-11T12:00:00Z");
const character = (id: string, name: string, extra: { memberId?: string; confirmedAt?: Date | null; linkEvidence?: string | null } = {}) =>
  ({ id, memberId: extra.memberId ?? "m1", name, realm: "", gameEdition: "forever", confirmedAt: extra.confirmedAt ?? null, linkEvidence: extra.linkEvidence ?? null });

describe("reported, not verified", () => {
  // Linking audit T8 (owner decision, 10 November 2026).
  it("is confirmed by the member's own companion only when the roster or a heard verify code agrees, or by an officer", () => {
    const own = { confirmedAt: NEW };
    // The member's own companion alone: a saved file can name any character.
    expect(characterTrust(own)).toBe("reported");
    expect(characterTrust(own, { inRoster: true })).toBe("confirmed");
    expect(characterTrust(own, { claim: "PROVISIONAL" })).toBe("confirmed");
    expect(characterTrust({ ...own, linkEvidence: "heard" })).toBe("confirmed");
    // The roster or a guildmate's addon alone: nothing says the character is this member's own.
    expect(characterTrust({ confirmedAt: null }, { inRoster: true })).toBe("reported");
    expect(characterTrust({ confirmedAt: null }, { claim: "PROVISIONAL" })).toBe("reported");
    expect(characterTrust({ confirmedAt: null, linkEvidence: "heard" }, { inRoster: true })).toBe("reported");
    // An officer: a hand link or move, or their own addon hearing the code.
    expect(characterTrust({ confirmedAt: null, linkEvidence: "officer" })).toBe("confirmed");
    expect(characterTrust({ confirmedAt: null }, { claim: "LINKED" })).toBe("confirmed");
    expect(characterTrust({ confirmedAt: null })).toBe("reported");
  });

  // Owner decision, November 2026 (/guilded verify removed): a link made from a sent name is confirmed by sync alone.
  it("confirms an invite-channel link (a PROVISIONAL claim) at the next sync that shows the character in the guild", async () => {
    expect(characterTrust({ confirmedAt: null }, { claim: "PROVISIONAL" })).toBe("reported");
    expect(characterTrust({ confirmedAt: null }, { claim: "PROVISIONAL", inRoster: true })).toBe("confirmed");
    // A bare named link (a DM, or a name an edited companion file listed) is not confirmed by the roster alone.
    expect(characterTrust({ confirmedAt: null, linkEvidence: "named" }, { inRoster: true })).toBe("reported");
    expect(characterTrust({ confirmedAt: null, linkEvidence: null }, { inRoster: true })).toBe("reported");
    const claims = vi.fn(async () => [{ memberId: "m1", nameKey: "walter sobchak", status: "PROVISIONAL" }, { memberId: "m1", nameKey: "donny kerabatsos", status: "PROVISIONAL" }]);
    const roster = vi.fn(async () => [{ nameKey: "walter sobchak", gameEdition: "forever" }]);
    const trust = await characterTrustMap({ characterVerifyClaim: { findMany: claims }, guildRosterEntry: { findMany: roster } } as never, "g1", [
      character("a", "Walter Sobchak", { linkEvidence: "named" }), character("b", "Donny Kerabatsos", { linkEvidence: "named" }), character("c", "Maude Lebowski", { linkEvidence: "named" })
    ]);
    // a: in the roster after the sync. b: claimed but not in the guild roster yet. c: no claim at all.
    expect(Object.fromEntries(trust)).toEqual({ a: "confirmed", b: "reported", c: "reported" });
  });

  it("grandfathers links confirmed before the strict rule went live", async () => {
    // Own companion (or an officer's hand link) before T8: confirmed as it always was, with no roster or code.
    expect(characterTrust({ confirmedAt: OLD })).toBe("confirmed");
    expect(characterTrust({ confirmedAt: NEW })).toBe("reported");
    expect(characterTrust({ confirmedAt: T8_STRICT_FROM })).toBe("reported");
    const roster = vi.fn(async () => []);
    const trust = await characterTrustMap({ characterVerifyClaim: { findMany: vi.fn(async () => []) }, guildRosterEntry: { findMany: roster } } as never, "g1", [
      character("old", "Old Link", { confirmedAt: OLD }), character("new", "New Link", { confirmedAt: NEW }), character("named", "Name Match")
    ]);
    expect(Object.fromEntries(trust)).toEqual({ old: "confirmed", new: "reported", named: "reported" });
    // Only the new own-companion link needs the roster.
    expect(roster).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ nameKey: { in: ["new link"] } }) }));
  });

  it("reads the verify claims and the roster once each for a whole list", async () => {
    const claims = vi.fn(async () => [{ memberId: "m1", nameKey: "lebowski holyroller", status: "LINKED" }, { memberId: "m1", nameKey: "the stranger", status: "PROVISIONAL" }]);
    const roster = vi.fn(async () => [{ nameKey: "donny kerabatsos", gameEdition: "forever" }, { nameKey: "walter sobchak", gameEdition: "forever" }]);
    const trust = await characterTrustMap({ characterVerifyClaim: { findMany: claims }, guildRosterEntry: { findMany: roster } } as never, "g1", [
      character("a", "Lebowski Holyroller"), // an officer's addon heard the code
      character("b", "Walter Sobchak"), // in the roster, but never uploaded by the member's own companion
      character("c", "Donny Kerabatsos", { confirmedAt: NEW }), // own companion + roster
      character("d", "Jesus Quintana", { confirmedAt: NEW }), // own companion only (not in this guild)
      character("e", "The Stranger", { confirmedAt: NEW }), // own companion + a guildmate's addon
      character("f", "Maude Lebowski", { linkEvidence: "officer" }) // an officer's link
    ]);
    expect(Object.fromEntries(trust)).toEqual({ a: "confirmed", b: "reported", c: "confirmed", d: "reported", e: "confirmed", f: "confirmed" });
    expect(claims).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g1", status: { in: ["LINKED", "PROVISIONAL"] }, memberId: { in: ["m1"] } } }));
    // Only characters the member's own companion uploaded are looked up, and only members still in the guild count.
    expect(roster).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g1", inGuild: true, nameKey: { in: ["donny kerabatsos", "jesus quintana", "the stranger"] } } }));
  });

  it("asks nothing when an officer linked every character", async () => {
    const findMany = vi.fn();
    const trust = await characterTrustMap({ characterVerifyClaim: { findMany }, guildRosterEntry: { findMany } } as never, "g1", [character("a", "Ann Lee", { linkEvidence: "officer" })]);
    expect(findMany).not.toHaveBeenCalled();
    expect(trust.get("a")).toBe("confirmed");
  });

  it("has short English and French labels", () => {
    expect(trustLabel("reported")).toBe("reported, not verified");
    expect(trustLabel("reported", "fr")).toBe("signalé, non vérifié");
    expect(trustLabel("confirmed", "fr")).toBe("confirmé");
    expect(trustSuffix("reported")).toBe(" · ⚠️ reported, not verified");
    expect(trustSuffix(undefined)).toBe("");
  });

  it("lists the member's characters with their label on the website, and explains reported ones", async () => {
    const database = {
      character: { findMany: vi.fn(async () => [
        { ...character("a", "Ann Lee", { confirmedAt: NEW }), displayName: null, isMain: true, level: 31, className: "Mage", race: "Human", guildRankName: null, member: { guildId: "g1", guild: { name: "Quebec Gold" } } },
        { ...character("b", "Bo <Script>"), displayName: null, isMain: false, level: null, className: "Rogue", race: null, guildRankName: "Recruit", member: { guildId: "g1", guild: { name: "Quebec Gold" } } }
      ]) },
      characterVerifyClaim: { findMany: vi.fn(async () => []) },
      guildRosterEntry: { findMany: vi.fn(async () => [{ nameKey: "ann lee", gameEdition: "forever", rankName: "Officer" }]) }
    };
    const list = await meCharacterList(database as never)("user");
    expect(list).toEqual([
      { id: "a", name: "Ann Lee", isMain: true, trust: "confirmed", level: 31, className: "Mage", race: "Human", serverName: "Quebec Gold", inGuild: true, guildRank: "Officer", armoryName: "Ann Lee" },
      { id: "b", name: "Bo <Script>", isMain: false, trust: "reported", level: null, className: "Rogue", race: null, serverName: "Quebec Gold", inGuild: false, guildRank: "Recruit", armoryName: "Bo <Script>" }
    ]);
    const status = async () => ({ battleNet: false, companion: true, characters: 2, lastSynced: null });
    const html = await charactersMeSection(status, async () => list)({ account: { discordUserId: "user" }, lang: "fr", now: new Date(), t: (_en: string, fr: string) => fr } as never);
    expect(html).toContain("<td>Ann Lee</td>");
    expect(html).toContain("<span class=\"trust-confirmed\">confirmé</span>");
    expect(html).toContain("<td>Bo &lt;Script&gt;</td>");
    expect(html).toContain("<span class=\"trust-reported\">signalé, non vérifié</span>");
    // The read-only table: server, guild rank, main, armory link (new tab, no referrer); the card carries the same armory button.
    expect(html).toContain("<td>Officer</td>");
    expect(html).toContain("Voir sur l'armurerie Blizzard");
    expect(html).toContain("/fr-fr/forever/us/armory/character/ann-lee");
    expect(html).toContain("/images/web/class-card-mage.webp");
    expect(html).toContain("rel=\"noopener noreferrer\"");
    expect(html).not.toMatch(/<(form|script|iframe)/);
    expect(html).toContain("quand votre propre application Guilded l'a synchronisé et que la liste de la guilde le confirme");
    // A failing list never hides the status lines.
    const safe = await charactersMeSection(status, async () => { throw new Error("db"); })({ account: { discordUserId: "user" }, lang: "en", now: new Date(), t: (en: string) => en } as never);
    expect(safe).toContain("Your characters");
    expect(safe).not.toContain("<ul>");
  });

  it("lists linked but reported characters in the officer roster gaps", () => {
    const gaps = { ...planRosterGaps({ syncFresh: true, members: [], characters: [], unclaimed: [] }), reported: [{ name: "Walter Sobchak", displayName: "Walt" }] };
    const { text } = formatRosterGaps(gaps, "en");
    expect(text).toContain("**Linked, reported but not verified** (1)");
    expect(text).toContain("Walter Sobchak (Walt)");
    expect(formatRosterGaps({ ...gaps, reported: [] }, "fr").text).toContain("**Liés, signalés mais non vérifiés** (0)");
    // Callers that do not check (omitted) show no section.
    expect(formatRosterGaps(planRosterGaps({ syncFresh: true, members: [], characters: [], unclaimed: [] }), "en").text).not.toContain("reported");
  });
});

describe("last roster update", () => {
  it("reads the newest roster reading, who brought it and how many are in the guild", async () => {
    const at = new Date("2026-11-08T20:00:00Z");
    const database = {
      guildRosterEntry: { findFirst: vi.fn(async () => ({ observedAt: at, reportedById: "m7" })), count: vi.fn(async () => 42) },
      member: { findUnique: vi.fn(async () => ({ displayName: "Maude" })) }
    };
    expect(await rosterFreshness(database as never, "g1")).toEqual({ at, by: "Maude", members: 42 });
    expect(database.guildRosterEntry.count).toHaveBeenCalledWith({ where: { guildId: "g1", gameEdition: "forever", inGuild: true } });
  });

  it("is null without any roster and has no name when the reporter is unknown", async () => {
    const none = { guildRosterEntry: { findFirst: vi.fn(async () => null), count: vi.fn() }, member: { findUnique: vi.fn() } };
    expect(await rosterFreshness(none as never, "g1")).toBeNull();
    const anonymous = { guildRosterEntry: { findFirst: vi.fn(async () => ({ observedAt: new Date(0), reportedById: null })), count: vi.fn(async () => 3) }, member: { findUnique: vi.fn() } };
    expect((await rosterFreshness(anonymous as never, "g1"))?.by).toBeNull();
    expect(anonymous.member.findUnique).not.toHaveBeenCalled();
  });
});
