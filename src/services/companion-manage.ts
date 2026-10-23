import type { PrismaClient, RaidRole } from "@prisma/client";
import { z } from "zod";
import { createWishlistService } from "./wishlist.js";
import { createItemValueService, parseItemValues } from "./item-values.js";
import { createRaidCoreService } from "./raid-core.js";
import { effectiveRules, LOOT_MODES } from "./core-rules.js";

// What a paired companion may look at and change besides its uploads: a member's own wishlists,
// and for Raid Leaders the item prices, rules and roster of the cores (the same rights as
// /wishlist, /core items, /core rules, /core add and /core character). Permissions are decided
// here from the member's Discord roles, never by the companion.

export interface ManageAccess { memberId: string; actorId: string; officer: boolean; raidLeader: boolean }

// An error whose message is ours and safe to show, with the HTTP status to answer.
export class ManageError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const LEADERS_ONLY = "Only Raid Leaders, Officers, Guild Masters, or Administrators can change this.";
const STALE = "Someone else changed this core since you opened it. Reload, then make your change again.";
const MAX_MEMBERS = 1_000;
const MAX_ITEM_NAMES = 2_000;

// The per-core values a companion may set; null goes back to the guild's default.
type Editable = "description" | "realm" | "attendanceEp" | "lateEp" | "bossEp" | "completionEp" | "baseGp" | "decayPercent" | "lootMode" | "reservesPerPlayer" | "offspecPercent" | "minEp";

const id = z.string().min(1).max(64);
const role = z.enum(["TANK", "HEALER", "DPS"]);
const characterName = z.string().trim().min(2).max(64);
const ep = z.number().int().min(0).max(1_000_000).nullable();
const changes = z.object({
  description: z.string().max(300).nullable(),
  realm: z.string().max(60).nullable(),
  attendanceEp: ep, lateEp: ep, bossEp: ep, completionEp: ep, baseGp: ep, minEp: ep,
  // Percent, as in /core rules; stored as a fraction.
  decayPercent: z.number().int().min(0).max(100).nullable(),
  lootMode: z.enum(LOOT_MODES as [string, ...string[]]).nullable(),
  reservesPerPlayer: z.number().int().min(1).max(5).nullable(),
  offspecPercent: z.number().int().min(0).max(100).nullable()
}).partial().strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("wishlist.set"), characterId: id, item: z.string().max(100), priority: z.number().int().min(1).max(3) }),
  z.object({ action: z.literal("wishlist.remove"), characterId: id, item: z.string().max(100) }),
  z.object({ action: z.literal("prices.set"), coreId: id.nullable(), text: z.string().min(1).max(200_000) }),
  z.object({ action: z.literal("prices.remove"), coreId: id.nullable(), item: z.string().min(2).max(100) }),
  // `base` is what the companion showed before the edit: a value changed meanwhile is refused.
  z.object({ action: z.literal("core.update"), coreId: id, base: z.record(z.string(), z.unknown()), changes }),
  z.object({ action: z.literal("core.member.set"), coreId: id, memberId: id, role, bench: z.boolean(), character: characterName.nullable().optional() }),
  z.object({ action: z.literal("core.member.remove"), coreId: id, memberId: id }),
  z.object({ action: z.literal("core.character"), coreId: id, memberId: id, character: characterName.nullable() }),
  z.object({ action: z.literal("core.backup.set"), coreId: id, memberId: id, character: characterName, role }),
  z.object({ action: z.literal("core.backup.remove"), coreId: id, memberId: id, character: characterName })
]);
export type ManageAction = z.infer<typeof actionSchema>;

export interface ManageResult {
  message: string;
  // The core whose roster message must be refreshed in Discord.
  rosterCoreId?: string;
  // Recorded in the audit log (leadership changes only).
  audit?: Record<string, string | number | boolean | null>;
}

const percent = (fraction: number | null) => (fraction === null ? null : Math.round(fraction * 100));

type CoreRow = { description: string | null; realm: string | null; attendanceEp: number | null; lateEp: number | null; bossEp: number | null; completionEp: number | null; baseGp: number | null; decayPercent: number | null; lootMode: string | null; reservesPerPlayer: number | null; offspecPercent: number | null; minEp: number | null };

// A core's own values as the companion edits them (decay in percent).
export function coreOwnValues(core: CoreRow): Record<Editable, string | number | null> {
  return {
    description: core.description, realm: core.realm,
    attendanceEp: core.attendanceEp, lateEp: core.lateEp, bossEp: core.bossEp, completionEp: core.completionEp,
    baseGp: core.baseGp, decayPercent: percent(core.decayPercent), lootMode: core.lootMode,
    reservesPerPlayer: core.reservesPerPlayer, offspecPercent: core.offspecPercent, minEp: core.minEp
  };
}

export function createCompanionManage(database: PrismaClient) {
  const wishlist = createWishlistService(database);
  const prices = createItemValueService(database);
  const cores = createRaidCoreService(database);

  const requireLeader = (access: ManageAccess) => { if (!access.raidLeader) throw new ManageError(LEADERS_ONLY, 403); };

  async function ownCharacter(access: ManageAccess, characterId: string) {
    const character = await database.character.findFirst({ where: { id: characterId, memberId: access.memberId } });
    if (!character) throw new ManageError("That character is not linked to your profile.", 403);
    return character;
  }

  async function coreOf(guildId: string, coreId: string) {
    const core = await database.raidCore.findFirst({ where: { id: coreId, guildId } });
    if (!core) throw new ManageError("That core no longer exists. Reload.", 404);
    return core;
  }

  async function memberOf(guildId: string, memberId: string) {
    const member = await database.member.findFirst({ where: { id: memberId, guildId, status: "ACTIVE" }, select: { id: true, displayName: true } });
    if (!member) throw new ManageError("That player is not an active member of this guild.", 404);
    return member;
  }

  return {
    // Everything the companion's pages show. Rosters and prices are readable by every member (as
    // in Discord); the member list for adding players is for Raid Leaders only.
    async view(guildId: string, access: ManageAccess) {
      const settings = await database.guildSettings.findUnique({ where: { guildId } });
      const [characters, coreRows, guildPrices, allPrices, wishes, awards] = await Promise.all([
        database.character.findMany({
          where: { memberId: access.memberId }, orderBy: [{ isMain: "desc" }, { name: "asc" }],
          select: { id: true, name: true, realm: true, className: true, isMain: true, wishlist: { orderBy: [{ priority: "asc" }, { itemName: "asc" }], select: { itemName: true, priority: true } } }
        }),
        cores.list(guildId),
        settings?.coreLootOnly ? Promise.resolve([]) : prices.list(guildId, null),
        database.coreItemValue.findMany({ where: { guildId }, select: { itemName: true, coreId: true, itemKey: true, itemId: true, gp: true }, orderBy: { itemName: "asc" } }),
        database.wishlistEntry.findMany({ where: { character: { member: { guildId } } }, select: { itemName: true }, distinct: ["itemKey"], take: MAX_ITEM_NAMES }),
        database.lootAward.findMany({ where: { guildId }, select: { itemName: true }, distinct: ["itemName"], orderBy: { itemName: "asc" }, take: MAX_ITEM_NAMES })
      ]);
      const members = access.raidLeader ? await database.member.findMany({
        where: { guildId, status: "ACTIVE", isTest: false }, orderBy: { displayName: "asc" }, take: MAX_MEMBERS,
        select: { id: true, displayName: true, characters: { select: { name: true, realm: true, className: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] } }
      }) : [];
      // Names to suggest when typing an item: priced, wishlisted or awarded before. Skips "Item 123".
      const itemNames = [...new Set([...allPrices, ...wishes, ...awards].map((row) => row.itemName).filter((name) => !/^Item \d+$/.test(name)))]
        .sort((a, b) => a.localeCompare(b)).slice(0, MAX_ITEM_NAMES);
      return {
        me: { officer: access.officer, raidLeader: access.raidLeader },
        coreLootOnly: settings?.coreLootOnly ?? false,
        lootModes: LOOT_MODES,
        characters,
        guildPrices: guildPrices.map((row) => ({ name: row.name, id: row.id, gp: row.gp })),
        cores: coreRows.map((core) => {
          const rules = effectiveRules(settings, core);
          return {
            id: core.id, name: core.name, schedule: core.schedule,
            own: coreOwnValues(core),
            effective: { attendanceEp: rules.attendanceEp, lateEp: rules.lateEp, bossEp: rules.bossEp, completionEp: rules.completionEp, baseGp: rules.baseGp, decayPercent: Math.round(rules.decayPercent * 100), lootMode: rules.lootMode, reservesPerPlayer: rules.reservesPerPlayer, separatePool: rules.separatePool, offspecPercent: rules.offspecPercent, minEp: rules.minEp },
            prices: allPrices.filter((row) => row.coreId === core.id).map((row) => ({ name: row.itemName, id: row.itemId, gp: row.gp })),
            members: core.members.map((spot) => ({
              memberId: spot.memberId, name: spot.member.displayName, role: spot.role, bench: spot.bench, trial: spot.trial,
              character: spot.character?.name ?? null,
              backups: spot.backups.map((backup) => ({ character: backup.character.name, role: backup.role }))
            }))
          };
        }),
        members,
        itemNames
      };
    },

    async apply(guildId: string, access: ManageAccess, input: unknown): Promise<ManageResult> {
      const action = actionSchema.parse(input);

      if (action.action === "wishlist.set" || action.action === "wishlist.remove") {
        const character = await ownCharacter(access, action.characterId);
        if (action.action === "wishlist.remove") {
          await wishlist.remove(character.id, action.item);
          return { message: `Removed ${action.item.trim()} from ${character.name}'s wishlist.` };
        }
        const entry = await wishlist.add(character.id, action.item, action.priority);
        return { message: `${entry.itemName} is on ${character.name}'s wishlist.` };
      }

      requireLeader(access);

      if (action.action === "prices.set" || action.action === "prices.remove") {
        const core = action.coreId ? await coreOf(guildId, action.coreId) : null;
        const scope = core ? core.name : "the whole guild";
        if (action.action === "prices.remove") {
          const parsed = parseItemValues(`${action.item} = 0`).values[0];
          if (!parsed) throw new ManageError("That does not look like an item name.");
          const removed = await prices.remove(guildId, core?.id ?? null, parsed);
          if (!removed) throw new ManageError(`${action.item} had no price set for ${scope}.`, 404);
          return { message: `Removed the price of ${action.item} for ${scope}.`, audit: { coreId: core?.id ?? null, item: action.item } };
        }
        const parsed = parseItemValues(action.text);
        if (parsed.values.length === 0) throw new ManageError(parsed.problems[0] ?? "No prices found. Use one \"item = price\" per line.");
        const saved = await prices.setMany(guildId, core?.id ?? null, parsed.values);
        const skipped = parsed.problems.length ? ` ${parsed.problems.length} line(s) skipped: ${parsed.problems.slice(0, 3).join(" ")}` : "";
        return { message: `Saved ${saved} price(s) for ${scope}.${skipped}`, audit: { coreId: core?.id ?? null, prices: saved } };
      }

      const core = await coreOf(guildId, action.coreId);

      if (action.action === "core.update") {
        const current = coreOwnValues(core);
        const keys = (Object.keys(action.changes) as Editable[]).filter((key) => action.changes[key] !== undefined);
        if (keys.length === 0) throw new ManageError("Nothing to change.");
        for (const key of keys) if ((action.base[key] ?? null) !== current[key]) throw new ManageError(STALE, 409);
        const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { coreLootOnly: true } });
        if (settings?.coreLootOnly && keys.includes("lootMode") && action.changes.lootMode === null) {
          throw new ManageError("Choisis le système de butin de ce core : GP bids, council, reserves ou priority.");
        }
        const data: Record<string, string | number | null> = {};
        for (const key of keys) {
          const value = action.changes[key] ?? null;
          if (key === "decayPercent") data[key] = value === null ? null : (value as number) / 100;
          else if (key === "description" || key === "realm") data[key] = (value as string | null)?.trim() || null;
          else data[key] = value;
        }
        await database.raidCore.update({ where: { id: core.id }, data });
        return { message: `Saved ${core.name}.`, rosterCoreId: core.id, audit: { coreId: core.id, fields: keys.join(",") } };
      }

      const member = await memberOf(guildId, action.memberId);
      const done = (message: string, detail: string): ManageResult => ({ message, rosterCoreId: core.id, audit: { coreId: core.id, memberId: member.id, change: detail } });

      if (action.action === "core.member.set") {
        await cores.addMember(guildId, core.id, member.id, action.role as RaidRole, action.bench, action.character ?? null);
        return done(`${member.displayName} is in ${core.name} (${action.role}${action.bench ? ", bench" : ""}).`, `set ${action.role}${action.bench ? " bench" : ""}`);
      }
      if (action.action === "core.member.remove") {
        await cores.removeMember(guildId, core.id, member.id);
        return done(`Removed ${member.displayName} from ${core.name}.`, "removed");
      }
      if (action.action === "core.character") {
        const { character } = await cores.setCharacter(guildId, core.id, member.id, action.character);
        return done(character ? `${member.displayName} brings ${character.name} to ${core.name}.` : `Cleared the character of ${member.displayName} in ${core.name}.`, `character ${character?.name ?? "cleared"}`);
      }
      if (action.action === "core.backup.set") {
        const { character } = await cores.addBackup(guildId, core.id, member.id, action.character, action.role as RaidRole);
        return done(`${member.displayName} can also bring ${character.name} (${action.role}) to ${core.name}.`, `backup ${character.name} ${action.role}`);
      }
      const { character } = await cores.removeBackup(guildId, core.id, member.id, action.character);
      return done(`${character.name} is no longer a backup of ${member.displayName} in ${core.name}.`, `backup removed ${character.name}`);
    }
  };
}

// Edits per member, so a stolen or looping companion cannot rewrite a guild's data at speed.
const WRITE_WINDOW_MS = 5 * 60_000;
const MAX_WRITES = 120;
const writes = new Map<string, number[]>();
export function allowManageWrite(memberId: string, now = Date.now()): boolean {
  const recent = (writes.get(memberId) ?? []).filter((at) => now - at < WRITE_WINDOW_MS);
  if (recent.length >= MAX_WRITES) { writes.set(memberId, recent); return false; }
  if (writes.size > 5_000) writes.clear();
  writes.set(memberId, [...recent, now]);
  return true;
}
export function resetManageWrites(): void { writes.clear(); }
