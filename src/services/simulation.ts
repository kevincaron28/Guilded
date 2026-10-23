import type { PrismaClient, RaidRole } from "@prisma/client";
import { createAddonImportService } from "./addon-import.js";
import { createLootService } from "./loot.js";
import { createRaidService } from "./raid.js";

// Test raid environment. WoW Forever has no raids released yet, so this
// fakes one end to end through the real code paths (signups with caps,
// Maybe and waitlist, attendance, boss kills, loot auctions, EP proposal,
// raid report, and the addon import). Everything it creates is flagged
// isTest and removed by cleanupTestRaids; test members are separate
// Member rows, so real players' EPGP is never touched.
//
// The same character names are used by the addon's /guilded sim, so an in-game
// test raid exported by the companion matches these characters on import.
export const SIM_CHARACTERS = [
  "Testalpha", "Testbravo", "Testcharlie", "Testdelta", "Testecho", "Testfoxtrot",
  "Testgolf", "Testhotel", "Testindia", "Testjuliet", "Testkilo", "Testlima"
];
const SIM_CLASSES = ["Warrior", "Paladin", "Priest", "Druid", "Shaman", "Mage", "Rogue", "Hunter", "Warlock"];
export const SIM_BOSSES = ["Test Boss One", "Test Boss Two", "Test Boss Three"];
export const SIM_IMPORT_SOURCE = "Guilded-Simulation";
// Dungeon runs from /setup testraid dungeon and the addon's /guilded sim dungeon: a
// made-up dungeon so they never mix with real records, and a SIM- run id
// so /setup testraid cleanup can find them.
export const SIM_DUNGEON = { instanceId: 999001, name: "Test Dungeon" };
export const SIM_RUN_PREFIX = "SIM-";

export interface SimStartInput {
  guildId: string;
  createdBy: string;
  officerMemberId: string;
  realm: string;
  raiders: number;
  startsInMinutes: number;
}

// Creates (or reuses) the test members and characters, a [TEST] raid with
// role caps small enough to force a waitlist, and a mix of signups.
async function ensureTestMembers(database: PrismaClient, guildId: string, realm: string, count: number) {
  const members = [];
  for (let i = 0; i < count; i++) {
    const name = SIM_CHARACTERS[i] ?? `Test${i}`;
    const member = await database.member.upsert({
      where: { guildId_discordUserId: { guildId, discordUserId: `sim-${i + 1}` } },
      create: { guildId, discordUserId: `sim-${i + 1}`, displayName: `${name} (test)`, isTest: true },
      update: { isTest: true, status: "ACTIVE" }
    });
    await database.character.upsert({
      where: { realm_name: { realm, name } },
      create: { memberId: member.id, name, realm, className: SIM_CLASSES[i % SIM_CLASSES.length] ?? "Warrior", isMain: true, level: 60 },
      update: {}
    });
    members.push(member);
  }
  return members;
}

export async function startTestRaid(database: PrismaClient, input: SimStartInput) {
  const raidService = createRaidService(database);
  const raiders = Math.min(Math.max(input.raiders, 6), SIM_CHARACTERS.length);
  const members = await ensureTestMembers(database, input.guildId, input.realm, raiders);

  // Caps: 2 tanks, 3 healers, and DPS one short of the rest, so the last
  // DPS lands on the waitlist.
  const dpsCap = Math.max(1, raiders - 2 - 3 - 2 - 1);
  const raid = await raidService.create({
    guildId: input.guildId,
    title: "[TEST] Simulated raid",
    description: "Test raid from /setup testraid. Remove it with /setup testraid cleanup.",
    scheduledAt: new Date(Date.now() + Math.max(2, input.startsInMinutes) * 60_000),
    createdBy: input.createdBy,
    bosses: SIM_BOSSES,
    tankLimit: 2,
    healerLimit: 3,
    dpsLimit: dpsCap
  });
  await database.raid.update({ where: { id: raid.id }, data: { isTest: true } });

  const counts: { SIGNED_UP: number; MAYBE: number; WAITLISTED: number; CANCELLED: number } = { SIGNED_UP: 0, MAYBE: 0, WAITLISTED: 0, CANCELLED: 0 };
  for (const [index, member] of members.entries()) {
    const role: RaidRole = index < 2 ? "TANK" : index < 5 ? "HEALER" : "DPS";
    // Two players answer Maybe; everyone else is Available.
    const availability = index === 5 || index === 6 ? "MAYBE" : "AVAILABLE";
    const signup = await raidService.signup(raid.id, input.guildId, member.id, role, availability);
    counts[signup.status] += 1;
  }
  return { raid, counts, members: members.length };
}

// Plays the raid: attendance (one late, one no-show, one walk-in from the
// waitlist), all bosses killed, two loot auctions won by test players, and
// ends it. With viaAddon, attendance comes from a generated addon import
// instead (the officer applies it with /import apply), exercising the
// companion import path.
export async function finishTestRaid(database: PrismaClient, input: { guildId: string; raidId: string; officerId: string; realm: string; viaAddon: boolean }) {
  const raidService = createRaidService(database);
  const lootService = createLootService(database);
  const raid = await database.raid.findFirst({
    where: { id: input.raidId, guildId: input.guildId },
    include: { bosses: true, signups: { include: { member: { include: { characters: true } } } } }
  });
  if (!raid) throw new Error("Raid not found in this guild.");
  if (!raid.isTest) throw new Error("That is a real raid. /setup testraid only plays [TEST] raids.");
  if (raid.status === "PLANNED") await raidService.start(raid.id, input.guildId);
  if (raid.status === "COMPLETED" || raid.status === "CANCELLED") throw new Error("That test raid is already over. Start a new one.");

  const signedUp = raid.signups.filter((signup) => signup.status === "SIGNED_UP");
  const waitlisted = raid.signups.filter((signup) => signup.status === "WAITLISTED");
  const noShow = signedUp.at(-1);
  const late = signedUp[1];
  const walkIn = waitlisted[0];
  const attending = [...signedUp.filter((signup) => signup !== noShow), ...(walkIn ? [walkIn] : [])];

  for (const boss of raid.bosses) await raidService.setBossStatus(raid.id, input.guildId, boss.id, "KILLED");

  // Loot: two auctions, test players bid, highest wins.
  const loot = [];
  for (const [index, item] of ["Test Helm of Testing", "Test Ring of Simulation"].entries()) {
    const auction = await lootService.createAuction({
      guildId: input.guildId, itemName: item, minimumBid: 10, bidIncrement: 5, durationSeconds: 120,
      createdBy: input.officerId, raidId: raid.id, bossName: raid.bosses[index]?.name
    });
    const bidders = attending.slice(index * 2, index * 2 + 3);
    for (const [bidIndex, bidder] of bidders.entries()) {
      await lootService.placeBid({ auctionId: auction.id, memberId: bidder.memberId, amount: 10 + bidIndex * 10 });
    }
    const closed = await lootService.closeAuction(auction.id, input.officerId);
    if (closed.award) loot.push({ item, winner: closed.award.member.displayName, gp: closed.award.amount });
  }

  let importId: string | null = null;
  if (input.viaAddon) {
    // What the addon + companion would send: presence for everyone who was
    // there, a LATE mark, and the no-show simply absent from the group.
    const importService = createAddonImportService(database);
    const payload = {
      source: SIM_IMPORT_SOURCE,
      exportedAt: new Date().toISOString(),
      raids: [{
        ref: `sim-${raid.id}`,
        title: raid.title,
        startedAt: raid.scheduledAt.toISOString(),
        endedAt: new Date().toISOString(),
        players: attending.map((signup) => ({
          character: signup.member.characters[0]?.name ?? signup.member.displayName,
          realm: input.realm,
          seen: true,
          ...(signup === late ? { status: "LATE" } : {})
        }))
      }],
      // An item given out in game (as GP bidding's Award would), to test the
      // loot-history import.
      loot: attending.slice(0, 1).map((signup) => ({
        ref: `sim-loot-${raid.id}`,
        character: signup.member.characters[0]?.name ?? signup.member.displayName,
        realm: input.realm,
        item: "[Test Cloak of Importing]",
        gp: 15,
        raidRef: `sim-${raid.id}`,
        boss: SIM_BOSSES[2]
      }))
    };
    const preview = await importService.preview(input.guildId, payload, input.officerId);
    importId = (await importService.record(input.guildId, preview.snapshot, preview.checksum, input.officerId)).id;
  } else {
    for (const signup of attending) {
      await raidService.recordAttendance({
        raidId: raid.id, guildId: input.guildId, memberId: signup.memberId,
        status: signup === late ? "LATE" : "PRESENT", recordedBy: input.officerId, notes: "Test raid"
      });
    }
    if (noShow) {
      await raidService.recordAttendance({
        raidId: raid.id, guildId: input.guildId, memberId: noShow.memberId,
        status: "ABSENT", recordedBy: input.officerId, notes: "Test raid no-show"
      });
    }
  }
  const ended = await raidService.end(raid.id, input.guildId);
  return {
    raid: ended,
    attending: attending.length,
    late: late?.member.displayName ?? null,
    noShow: noShow?.member.displayName ?? null,
    walkIn: walkIn?.member.displayName ?? null,
    loot,
    importId
  };
}

// Removes every test raid, test member (and, by cascade, their characters,
// signups, attendance, EPGP, loot, and bank/craft requests), test auctions,
// and simulated imports. Real data is untouched.
export async function cleanupTestRaids(database: PrismaClient, guildId: string) {
  const raids = await database.raid.findMany({ where: { guildId, isTest: true }, select: { id: true } });
  const raidIds = raids.map((raid) => raid.id);
  const auctions = await database.auction.deleteMany({ where: { guildId, raidId: { in: raidIds } } });
  const raidRows = await database.raid.deleteMany({ where: { guildId, isTest: true } });
  const members = await database.member.deleteMany({ where: { guildId, isTest: true } });
  const imports = await database.addonImport.deleteMany({ where: { guildId, source: SIM_IMPORT_SOURCE } });
  // Test dungeon runs, and the points they gave (an officer in an in-game
  // test run is a real member, so those points must go too).
  await database.dungeonPointTransaction.deleteMany({ where: { guildId, run: { runRef: { startsWith: SIM_RUN_PREFIX } } } });
  const dungeonRuns = await database.dungeonRun.deleteMany({ where: { guildId, runRef: { startsWith: SIM_RUN_PREFIX } } });
  return { raids: raidRows.count, members: members.count, auctions: auctions.count, imports: imports.count, dungeonRuns: dungeonRuns.count };
}

// A fake completed dungeon run by five test characters, sent through the
// real addon import (validation, dedupe, points, records). Run it twice to
// see the weekly repeat share and a new record.
export async function simulateDungeonRun(database: PrismaClient, input: { guildId: string; realm: string; officerId: string; minutes?: number; deaths?: boolean; now?: Date }) {
  const members = await ensureTestMembers(database, input.guildId, input.realm, 5);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const durationSec = Math.round((input.minutes ?? 20 + Math.random() * 10) * 60);
  const roles = ["TANK", "HEALER", "DPS", "DPS", "DPS"];
  const run = {
    id: `${SIM_RUN_PREFIX}${now}-${Math.random().toString(36).slice(2, 7)}`,
    protocolVersion: 1,
    state: "COMPLETED",
    instanceId: SIM_DUNGEON.instanceId,
    name: SIM_DUNGEON.name,
    difficultyId: 1,
    startedAt: now - durationSec,
    endedAt: now,
    completedBy: "boss",
    reporters: 2,
    players: members.map((_, i) => ({
      character: SIM_CHARACTERS[i] ?? `Test${i}`,
      realm: input.realm,
      role: roles[i] ?? "DPS",
      // One untracked player (no addon): no death bonus, never assumed 0.
      deaths: i === 4 ? null : input.deaths && i === 2 ? 2 : 0,
      presentSec: durationSec,
      inGuild: true
    }))
  };
  const importService = createAddonImportService(database);
  const snapshot = importService.parse({ source: SIM_IMPORT_SOURCE, exportedAt: new Date(now * 1000).toISOString(), dungeonRuns: [run] });
  const checksum = `sim-dungeon-${run.id}`;
  const record = await importService.record(input.guildId, snapshot, checksum, input.officerId);
  return importService.apply(input.guildId, record.id, input.officerId);
}
