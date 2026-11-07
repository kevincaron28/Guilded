import { describe, expect, it, vi } from "vitest";
import { prelinkInvitedCharacters } from "../src/services/invite-prelink.js";

vi.mock("../src/services/character-pairing.js", () => ({ linkPairedCharacter: vi.fn(async () => "linked") }));
import { linkPairedCharacter } from "../src/services/character-pairing.js";

const entry = (name: string, cls = "Mage") => ({ name, realm: "forever", class: cls, race: "", level: 20, spec: "", professions: [] as never[] });
function setup(requests: { nameKey: string; discordUserId: string }[], opts: { claims?: { status: string }[]; roster?: unknown[]; member?: boolean } = {}) {
  const upsert = vi.fn(async () => ({}));
  const database = {
    inviteRequest: { findMany: vi.fn(async () => requests) },
    member: { findFirst: vi.fn(async () => (opts.member === false ? null : { id: "m1" })) },
    character: { findFirst: vi.fn(async () => ({ isMain: true })) },
    characterVerifyClaim: { findMany: vi.fn(async () => opts.claims ?? []), upsert },
    guildRosterEntry: { findMany: vi.fn(async () => opts.roster ?? []) }
  };
  return { database, upsert };
}

describe("pre-linking a character asked for in the invite channel", () => {
  it("links the requester once the full name is seen, provisionally", async () => {
    vi.mocked(linkPairedCharacter).mockClear();
    const { database, upsert } = setup([{ nameKey: "amy archer", discordUserId: "u1" }]);
    const results = await prelinkInvitedCharacters(database as never, "g1", [entry("Amy Archer")]);
    expect(results).toEqual([{ discordUserId: "u1", name: "Amy Archer", isMain: true }]);
    expect(linkPairedCharacter).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: "PROVISIONAL" }) }));
  });
  it("uses the stored guild roster too", async () => {
    const { database } = setup([{ nameKey: "amy archer", discordUserId: "u1" }], { roster: [{ name: "Amy Archer", level: 12, className: "Hunter" }] });
    expect(await prelinkInvitedCharacters(database as never, "g1", [])).toHaveLength(1);
  });
  it("never links a name two people asked for", async () => {
    const { database } = setup([{ nameKey: "amy archer", discordUserId: "u1" }, { nameKey: "amy archer", discordUserId: "u2" }]);
    expect(await prelinkInvitedCharacters(database as never, "g1", [entry("Amy Archer")])).toEqual([]);
  });
  it("skips a first name only, an unlinked one, a name without a member, and an owned one", async () => {
    expect(await prelinkInvitedCharacters(setup([{ nameKey: "amy", discordUserId: "u1" }]).database as never, "g1", [entry("Amy")])).toEqual([]);
    expect(await prelinkInvitedCharacters(setup([{ nameKey: "amy archer", discordUserId: "u1" }], { claims: [{ status: "REMOVED" }] }).database as never, "g1", [entry("Amy Archer")])).toEqual([]);
    expect(await prelinkInvitedCharacters(setup([{ nameKey: "amy archer", discordUserId: "u1" }], { member: false }).database as never, "g1", [entry("Amy Archer")])).toEqual([]);
    vi.mocked(linkPairedCharacter).mockResolvedValueOnce("owned-by-another" as never);
    expect(await prelinkInvitedCharacters(setup([{ nameKey: "amy archer", discordUserId: "u1" }]).database as never, "g1", [entry("Amy Archer")])).toEqual([]);
  });
  it("ignores a character with no class yet", async () => {
    expect(await prelinkInvitedCharacters(setup([{ nameKey: "amy archer", discordUserId: "u1" }]).database as never, "g1", [entry("Amy Archer", "")])).toEqual([]);
  });
});
