import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";

const mocks = vi.hoisted(() => ({ database: {} as Record<string, unknown> }));
vi.mock("../src/database.js", () => ({ prisma: mocks.database }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: async () => ({ guildId: "g1", memberId: "m-officer" }), guildService: {}
}));

const { buildExport, csvBuffer, csvCell, toCsv, EXPORT_KINDS } = await import("../src/services/exports.js");
const { executeExport, exportCommand } = await import("../src/commands/export.js");
const { commands } = await import("../src/commands/index.js");
const { resolveCommand } = await import("../src/commands/router.js");
const { allowsLite, liteCommandJson } = await import("../src/commands/lite.js");

// Two guilds' data in one fake database: every query filters by the guild it is given, the way
// Postgres would, so a missing guild filter shows up as the other guild's rows in the file.
const members = [
  { id: "a", guildId: "g1", displayName: "Amélie", status: "ACTIVE", isTest: false, characters: [{ name: "Amé", isMain: true }] },
  { id: "b", guildId: "g1", displayName: "Bob, \"the tank\"", status: "ACTIVE", isTest: false, characters: [] },
  { id: "x", guildId: "g2", displayName: "OtherGuild", status: "ACTIVE", isTest: false, characters: [] }
];
const byId = new Map(members.map((m) => [m.id, m]));
const ledger = [
  { id: "t1", guildId: "g1", memberId: "a", coreId: null, epAmount: 100, gpAmount: 10, type: "EP_AWARD", reason: "Raid, night 1", createdAt: new Date("2026-10-01T20:00:00Z") },
  { id: "t2", guildId: "g1", memberId: "b", coreId: null, epAmount: 50, gpAmount: 50, type: "ITEM_AWARD", reason: "Line\nbreak", createdAt: new Date("2026-10-02T20:00:00Z") },
  { id: "t3", guildId: "g1", memberId: "a", coreId: "core1", epAmount: 30, gpAmount: 0, type: "EP_AWARD", reason: "Core night", createdAt: new Date("2026-10-03T20:00:00Z") },
  { id: "t4", guildId: "g2", memberId: "x", coreId: null, epAmount: 999, gpAmount: 1, type: "EP_AWARD", reason: "Not ours", createdAt: new Date("2026-10-03T20:00:00Z") }
];
const raids = [
  { id: "r1", guildId: "g1", isTest: false, title: "Molten Core", scheduledAt: new Date("2026-10-01T20:00:00Z") },
  { id: "r2", guildId: "g2", isTest: false, title: "Other raid", scheduledAt: new Date("2026-10-01T20:00:00Z") }
];
const attendance = [
  { raidId: "r1", memberId: "a", status: "PRESENT", notes: "=SUM(A1)" },
  { raidId: "r2", memberId: "x", status: "PRESENT", notes: null }
];
const loot = [
  { guildId: "g1", memberId: "b", itemName: "Épée de l'aube", amount: 50, bossName: "Ragnaros", epBefore: 50, gpBefore: 0, awardedAt: new Date("2026-10-02T21:00:00Z") },
  { guildId: "g2", memberId: "x", itemName: "Not ours", amount: 1, bossName: null, epBefore: 0, gpBefore: 0, awardedAt: new Date("2026-10-02T21:00:00Z") }
];
const cores = [{ id: "core1", guildId: "g1", name: "Tuesday MC", separatePool: true, baseGp: 10 }, { id: "core2", guildId: "g2", name: "Theirs", separatePool: true, baseGp: null }];

type Where = { guildId?: string; separatePool?: boolean; raid?: { guildId: string } };
const fakeDatabase = {
  member: { findMany: vi.fn(async ({ where }: { where: Where }) => members.filter((m) => m.guildId === where.guildId)) },
  epgpTransaction: {
    findMany: vi.fn(async ({ where }: { where: Where }) => ledger.filter((e) => e.guildId === where.guildId).map((e) => ({ ...e, member: byId.get(e.memberId) }))),
    groupBy: vi.fn(async ({ where }: { where: Where }) => {
      const sums = new Map<string, { memberId: string; coreId: string | null; _sum: { epAmount: number; gpAmount: number } }>();
      for (const e of ledger.filter((row) => row.guildId === where.guildId)) {
        const key = `${e.memberId}|${e.coreId}`;
        const row = sums.get(key) ?? { memberId: e.memberId, coreId: e.coreId, _sum: { epAmount: 0, gpAmount: 0 } };
        row._sum.epAmount += e.epAmount; row._sum.gpAmount += e.gpAmount; sums.set(key, row);
      }
      return [...sums.values()];
    })
  },
  raidCore: { findMany: vi.fn(async ({ where }: { where: Where }) => cores.filter((c) => c.guildId === where.guildId && (where.separatePool === undefined || c.separatePool === where.separatePool))) },
  guildSettings: { findUnique: vi.fn(async ({ where }: { where: Where }) => (where.guildId === "g1" ? { baseGp: 0 } : { baseGp: 500 })) },
  raidAttendance: { findMany: vi.fn(async ({ where }: { where: Where }) => attendance
    .map((r) => ({ ...r, raid: raids.find((raid) => raid.id === r.raidId)!, member: byId.get(r.memberId)! }))
    .filter((r) => r.raid.guildId === where.raid?.guildId)) },
  lootAward: { findMany: vi.fn(async ({ where }: { where: Where }) => loot.filter((a) => a.guildId === where.guildId).map((a) => ({ ...a, member: byId.get(a.memberId) }))) }
};
Object.assign(mocks.database, fakeDatabase);

const lines = (csv: string) => csv.split("\r\n");

describe("CSV export", () => {
  it("quotes commas, quotes and line breaks as RFC 4180 says, and keeps accents", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("cr\r\nlf")).toBe('"cr\r\nlf"');
    expect(csvCell("Amélie Œuvre")).toBe("Amélie Œuvre");
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
  });

  it("defuses spreadsheet formulas typed by players, but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-5")).toBe("-5");
  });

  it("builds a header and CRLF rows, and the file starts with a UTF-8 byte-order mark", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
    const file = csvBuffer("nom\r\nAmélie\r\n");
    expect([...file.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(file.subarray(3).toString("utf8")).toBe("nom\r\nAmélie\r\n");
  });

  it("exports standings per pool, best PR first, for this guild only", async () => {
    const result = await buildExport(fakeDatabase as never, "g1", "standings");
    expect(lines(result.csv)).toEqual([
      "pool,rank,member,main,ep,gp,pr",
      "Guild pool,1,Amélie,Amé,100,10,10.000",
      'Guild pool,2,"Bob, ""the tank""",,50,50,1.000',
      // The core's own base GP (10): 30 / (0 + 10).
      "Tuesday MC,1,Amélie,Amé,30,0,3.000",
      ""
    ]);
    expect(result.rows).toBe(3);
    expect(result.csv).not.toContain("OtherGuild");
  });

  it("exports the EPGP ledger with pools and entry IDs", async () => {
    const result = await buildExport(fakeDatabase as never, "g1", "ledger");
    expect(result.filename).toBe("epgp-ledger.csv");
    expect(result.rows).toBe(3);
    expect(lines(result.csv)[0]).toBe("date,member,pool,type,ep,gp,reason,entry_id");
    expect(result.csv).toContain('2026-10-01T20:00:00.000Z,Amélie,Guild pool,EP_AWARD,100,10,"Raid, night 1",t1');
    expect(result.csv).toContain('"Line\nbreak"');
    expect(result.csv).toContain("Tuesday MC,EP_AWARD,30,0,Core night,t3");
    expect(result.csv).not.toContain("Not ours");
  });

  it("exports loot and attendance for this guild only", async () => {
    const lootFile = await buildExport(fakeDatabase as never, "g1", "loot");
    expect(lines(lootFile.csv)).toEqual(["date,winner,item,gp,boss,ep_before,gp_before", '2026-10-02T21:00:00.000Z,"Bob, ""the tank""",Épée de l\'aube,50,Ragnaros,50,0', ""]);
    const attendanceFile = await buildExport(fakeDatabase as never, "g1", "attendance");
    expect(lines(attendanceFile.csv)).toEqual(["raid,date,member,status,notes", "Molten Core,2026-10-01T20:00:00.000Z,Amélie,PRESENT,'=SUM(A1)", ""]);
    expect(fakeDatabase.raidAttendance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { raid: { guildId: "g1", isTest: false } } }));
  });

  it("exports the roster with one row per character", async () => {
    const database = {
      member: { findMany: async () => [
        { displayName: "Kev", characters: [{ name: "Kevin", realm: "R", className: "Priest", spec: "Shadow", level: 60, race: "Human", isMain: true, lastSeenAt: null }, { name: "Alt", realm: "R", className: "Mage", spec: null, level: 30, race: null, isMain: false, lastSeenAt: null }] },
        { displayName: "Newbie", characters: [] }
      ] }
    };
    const result = await buildExport(database as never, "g", "roster");
    expect(result.rows).toBe(3);
    expect(result.csv.split("\r\n")[0]).toBe("member,character,realm,class,spec,level,race,main,last_seen");
    expect(result.csv).toContain("Kev,Kevin,R,Priest,Shadow,60,Human,true,");
    expect(result.csv).toContain("Newbie,,,,,,,,");
  });
});

describe("/officer export", () => {
  const officerRole = { name: "Officer" };
  function interaction(roles: { name: string }[], table = "standings") {
    return {
      guild: { id: "discord-guild", name: "Guild" }, guildId: "discord-guild", inGuild: () => true,
      member: { permissions: { has: () => false }, roles: { cache: roles } },
      options: { getString: vi.fn(() => table) },
      reply: vi.fn(), deferReply: vi.fn(), editReply: vi.fn()
    };
  }
  beforeEach(() => { for (const fn of Object.values(fakeDatabase).flatMap((model) => Object.values(model))) fn.mockClear(); });

  it("refuses members without an officer role and reads nothing", async () => {
    const command = interaction([{ name: "Raider" }]);
    await executeExport(command as never);
    expect(command.reply).toHaveBeenCalledWith({ content: expect.stringContaining("Only Officers"), flags: MessageFlags.Ephemeral });
    expect(command.deferReply).not.toHaveBeenCalled();
    expect(fakeDatabase.member.findMany).not.toHaveBeenCalled();
  });

  it("answers an officer privately with this guild's CSV file", async () => {
    const command = interaction([officerRole], "ledger");
    await executeExport(command as never);
    expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const reply = command.editReply.mock.calls[0]![0] as { content: string; files: { name: string; attachment: Buffer }[] };
    expect(reply.content).toContain("3 rows");
    expect(reply.files[0]!.name).toBe("epgp-ledger.csv");
    const text = reply.files[0]!.attachment.toString("utf8");
    expect(text.startsWith("\uFEFFdate,member,pool")).toBe(true);
    expect(text).not.toContain("Not ours");
    expect(fakeDatabase.epgpTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g1" } }));
  });

  it("offers each table as a choice", () => {
    const option = exportCommand.toJSON().options?.[0] as { name: string; choices: { value: string }[] };
    expect(option.name).toBe("table");
    expect(option.choices.map((choice) => choice.value)).toEqual(EXPORT_KINDS);
  });

  it("lives under the hidden /officer parent, not /report, and Lite servers don't get it", () => {
    const officer = commands.find((command) => command.name === "officer")!;
    const json = officer.toJSON() as { default_member_permissions?: string; options: { name: string }[] };
    expect(json.options.map((option) => option.name)).toContain("export");
    expect(json.default_member_permissions).toBeDefined();
    const report = commands.find((command) => command.name === "report")!.toJSON() as { options: { name: string }[] };
    expect(report.options.map((option) => option.name)).not.toContain("export");
    const resolved = resolveCommand(commands, { commandName: "officer", options: { getSubcommand: () => "export", getSubcommandGroup: () => null } });
    expect(resolved).toMatchObject({ legacy: "export", sub: null, handler: executeExport });
    expect(allowsLite("officer", null, "export")).toBe(false);
    expect(liteCommandJson(commands as never).map((command) => command.name)).not.toContain("officer");
  });
});
