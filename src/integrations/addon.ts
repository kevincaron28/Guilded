import { z } from "zod";

export const addonTransactionSchema = z.object({
  createdAt: z.coerce.date().optional(),
  character: z.string().min(1),
  realm: z.string().min(1),
  amount: z.number().int().refine((amount) => amount !== 0, "must not be zero"),
  type: z.enum(["AWARD", "DEDUCTION", "ADJUSTMENT", "REFUND", "DECAY", "IMPORT"]),
  reason: z.string().min(3),
  sourceRef: z.string().min(1).optional()
});

// Separate from addonTransactionSchema because the addon's EPGP ledger tracks
// EP and GP independently per entry, not a single signed amount.
export const addonEpgpTransactionSchema = z.object({
  createdAt: z.coerce.date().optional(),
  coreId: z.string().min(1).max(100).optional(),
  character: z.string().min(1),
  realm: z.string().min(1),
  epAmount: z.number().int().default(0),
  gpAmount: z.number().int().default(0),
  type: z.enum(["EP_AWARD", "GP_AWARD", "ITEM_AWARD", "DEDUCTION", "ADJUSTMENT", "DECAY", "IMPORT", "REVERSAL"]),
  reason: z.string().min(3),
  sourceRef: z.string().min(1).optional()
}).refine((transaction) => transaction.epAmount !== 0 || transaction.gpAmount !== 0, "must change EP or GP");

const addonItemSchema = z.object({
  slot: z.string().min(1),
  itemName: z.string().min(1),
  itemId: z.string().min(1).optional(),
  itemLevel: z.number().int().nonnegative().optional(),
  durability: z.number().int().min(0).max(100).optional(),
  enchants: z.array(z.object({
    slot: z.string().min(1),
    name: z.string().min(1),
    enchantId: z.string().min(1).optional()
  })).default([])
});

const addonConsumableSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  category: z.string().min(1).optional()
});

const addonFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["INFO", "WARNING", "ERROR"]),
  message: z.string().min(1)
});

const addonProfessionSchema = z.object({
  name: z.string().min(1),
  skillLevel: z.number().int().nonnegative()
});

const addonReadinessSchema = z.object({
  character: z.string().min(1),
  realm: z.string().min(1),
  itemLevel: z.number().nonnegative().optional(),
  items: z.array(addonItemSchema).default([]),
  consumables: z.array(addonConsumableSchema).default([]),
  professions: z.array(addonProfessionSchema).default([]),
  professionsComplete: z.boolean().optional(),
  professionsAt: z.coerce.date().optional(),
  findings: z.array(addonFindingSchema).default([]),
  inspectedAt: z.coerce.date().optional()
});

// Attunement completion is self- or officer-reported in the addon (there is
// no reliable, server-agnostic quest-completion API to auto-detect this), so
// it travels as its own array rather than inside a point-in-time readiness
// snapshot.
export const addonAttunementSchema = z.object({
  character: z.string().min(1),
  realm: z.string().min(1),
  name: z.string().min(1),
  completed: z.boolean().default(true)
});

// A raid the officer ran in game (/guilded start ... /guilded end): who was marked,
// and who was seen in the raid group at any point. Matched to a Discord raid
// by start time on import.
export const addonRaidSchema = z.object({
  ref: z.string().min(1),
  coreId: z.string().min(1).max(100).optional(),
  title: z.string().min(1),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  players: z.array(z.object({
    character: z.string().min(1),
    realm: z.string().min(1),
    status: z.enum(["PRESENT", "LATE", "ABSENT"]).optional(),
    seen: z.boolean().default(false)
  })).default([])
});

export type AddonRaid = z.infer<typeof addonRaidSchema>;

// An item an officer gave out in game (/guilded loot, GP bidding Award). The GP
// itself arrives as a normal EPGP ledger entry; this is the loot history row.
export const addonLootSchema = z.object({
  ref: z.string().min(1),
  character: z.string().min(1),
  realm: z.string().min(1),
  item: z.string().min(1),
  gp: z.number().int().nonnegative().default(0),
  awardedAt: z.coerce.date().optional(),
  raidRef: z.string().min(1).optional(),
  boss: z.string().min(1).optional()
});

export type AddonLoot = z.infer<typeof addonLootSchema>;

// The exporting player's own character (name, realm, class, level...). Used
// to refresh the matching linked character; never creates one on its own.
export const addonCharacterSchema = z.object({
  name: z.string().min(1),
  realm: z.string().min(1),
  class: z.string().default(""),
  race: z.string().default(""),
  level: z.number().int().min(0).max(100).default(0),
  spec: z.string().default(""),
  professions: z.array(z.object({ name: z.string().min(1), skillLevel: z.number().int().nonnegative() })).default([]),
  professionsComplete: z.boolean().optional(),
  professionsAt: z.coerce.date().optional()
});

// Result of the officer's last /guilded consumes group scan.
export const addonConsumeScanSchema = z.object({
  at: z.coerce.date(),
  by: z.string().default(""),
  players: z.array(z.object({
    character: z.string().min(1),
    realm: z.string().min(1),
    flask: z.string().min(1).optional(),
    elixirs: z.array(z.string().min(1)).default([]),
    food: z.string().min(1).optional(),
    weapon: z.string().min(1).optional()
  })).max(100).default([])
});

// The soft-reserve list from the addon (/guilded reserve). It replaces the bot's copy
// when it is newer; a cleared list arrives with active = false and no entries.
export const addonReservesSchema = z.object({
  at: z.coerce.date(),
  by: z.string().default(""),
  title: z.string().default(""),
  limit: z.number().int().min(1).max(5).default(1),
  open: z.boolean().default(false),
  active: z.boolean().default(true),
  entries: z.array(z.object({
    character: z.string().min(1),
    realm: z.string().min(1),
    itemId: z.number().int().positive(),
    itemName: z.string().min(1).max(100)
  })).max(2000).default([])
});

export type AddonReserves = z.infer<typeof addonReservesSchema>;

// Who can craft what, from the addon's recipe scan (/guilded recipes). One entry per
// character and profession; keys are item ids, or minus a spell id for enchants.
export const addonRecipeSetSchema = z.object({
  character: z.string().min(1),
  realm: z.string().min(1),
  profession: z.string().min(1).max(40),
  at: z.coerce.date(),
  keys: z.array(z.number().int()).max(800)
});

export const addonCooldownSetSchema = z.object({
  character: z.string().min(1),
  realm: z.string().min(1),
  at: z.coerce.date(),
  entries: z.array(z.object({
    profession: z.string().min(1).max(40),
    name: z.string().min(1).max(60),
    readyAt: z.coerce.date()
  })).max(20)
});

export type AddonRecipeSet = z.infer<typeof addonRecipeSetSchema>;
export type AddonCooldownSet = z.infer<typeof addonCooldownSetSchema>;

// A guild event from the in-game calendar and how each member answered it (/guilded calendar sync).
export const addonCalendarEventSchema = z.object({
  botRaidId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  ref: z.string().min(1).max(80),
  title: z.string().min(1).max(100),
  startsAt: z.coerce.date(),
  invites: z.array(z.object({
    character: z.string().min(1),
    realm: z.string().min(1),
    status: z.enum(["ACCEPTED", "TENTATIVE", "DECLINED"])
  })).max(200).default([])
});

export type AddonCalendarEvent = z.infer<typeof addonCalendarEventSchema>;

export type AddonCharacter = z.infer<typeof addonCharacterSchema>;

// An item price an officer set in game (Modules/Loot.lua, when /guilded drop had none).
export const addonItemPriceSchema = z.object({
  name: z.string().min(2).max(100),
  id: z.number().int().positive().optional(),
  gp: z.number().int().min(0).max(100000),
  // The raid core it was set for ("" or missing = the guild-wide list).
  coreId: z.string().max(40).optional(),
  at: z.coerce.date()
});

export const addonSnapshotSchema = z.object({
  source: z.string().min(1),
  exportedAt: z.coerce.date(),
  wowGuild: z.string().optional(),
  character: addonCharacterSchema.optional(),
  // Every guildmate whose addon told the guild who they are (peer digests).
  characters: z.array(addonCharacterSchema).max(500).default([]),
  // Every character that logged in on the exporter's PC (the same WoW account): a paired
  // companion links them all to its member, not just the one that exported.
  alts: z.array(addonCharacterSchema).max(50).default([]),
  itemPrices: z.array(addonItemPriceSchema).max(500).default([]),
  consumeScan: addonConsumeScanSchema.optional(),
  reserves: addonReservesSchema.optional(),
  calendarEvents: z.array(addonCalendarEventSchema).max(100).default([]),
  recipes: z.array(addonRecipeSetSchema).max(400).default([]),
  recipeNames: z.record(z.string(), z.string().max(100)).default({}),
  cooldowns: z.array(addonCooldownSetSchema).max(300).default([]),
  transactions: z.array(addonTransactionSchema).default([]),
  epgpTransactions: z.array(addonEpgpTransactionSchema).default([]),
  readiness: z.array(addonReadinessSchema).default([]),
  attunements: z.array(addonAttunementSchema).default([]),
  raids: z.array(addonRaidSchema).default([]),
  loot: z.array(addonLootSchema).default([]),
  // Dungeon runs are validated one by one on apply (services/dungeon-rules),
  // so a single malformed run can't reject the whole import.
  dungeonRuns: z.array(z.unknown()).max(500).default([])
});

export type AddonSnapshot = z.infer<typeof addonSnapshotSchema>;

export function parseAddonSnapshot(payload: unknown): AddonSnapshot {
  return addonSnapshotSchema.parse(payload);
}

export function normalizeAddonSnapshot(snapshot: AddonSnapshot): AddonSnapshot {
  return {
    ...snapshot,
    source: snapshot.source.trim(),
    transactions: snapshot.transactions.map((transaction) => ({
      ...transaction,
      character: transaction.character.trim(),
      realm: transaction.realm.trim(),
      reason: transaction.reason.trim(),
      sourceRef: transaction.sourceRef?.trim()
    })),
    epgpTransactions: snapshot.epgpTransactions.map((transaction) => ({
      ...transaction,
      character: transaction.character.trim(),
      realm: transaction.realm.trim(),
      reason: transaction.reason.trim(),
      sourceRef: transaction.sourceRef?.trim()
    })),
    readiness: snapshot.readiness.map((entry) => ({
      ...entry,
      character: entry.character.trim(),
      realm: entry.realm.trim(),
      items: entry.items.map((item) => ({
        ...item,
        slot: item.slot.trim(),
        itemName: item.itemName.trim(),
        enchants: item.enchants.map((enchant) => ({ ...enchant, slot: enchant.slot.trim(), name: enchant.name.trim() }))
      })),
      consumables: entry.consumables.map((consumable) => ({ ...consumable, name: consumable.name.trim() })),
      professions: entry.professions.map((profession) => ({ ...profession, name: profession.name.trim() })),
      findings: entry.findings.map((finding) => ({ ...finding, code: finding.code.trim(), message: finding.message.trim() }))
    })),
    attunements: snapshot.attunements.map((attunement) => ({
      ...attunement,
      character: attunement.character.trim(),
      realm: attunement.realm.trim(),
      name: attunement.name.trim()
    })),
    raids: snapshot.raids.map((raid) => ({
      ...raid,
      title: raid.title.trim(),
      players: raid.players.map((player) => ({ ...player, character: player.character.trim(), realm: player.realm.trim() }))
    }))
  };
}
