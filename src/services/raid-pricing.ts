import { z } from "zod";

// These are policy values, not claims that unrevealed raid items are verified.
// The companion exports this same table to Lua; the addon has no second copy.
export const PRICING_PRESET = "december-flat-v1";
export const PRICING_SLOTS = [
  { key: "armorLarge", label: "Head, chest and legs", gp: 100 },
  { key: "armorMedium", label: "Shoulders, hands, waist and feet", gp: 75 },
  { key: "accessory", label: "Wrist, neck, cloak and ring", gp: 50 },
  { key: "trinket", label: "Trinket", gp: 100 },
  { key: "oneHand", label: "One-hand weapon", gp: 100 },
  { key: "offHand", label: "Shield or held off-hand", gp: 100 },
  { key: "twoHand", label: "Two-hand weapon", gp: 200 },
  { key: "ranged", label: "Bow, gun or crossbow", gp: 200 },
  { key: "relic", label: "Wand, thrown weapon or relic", gp: 25 },
  { key: "utility", label: "Bag or verified utility item", gp: 0 },
  { key: "legendary", label: "Completed legendary", gp: 400 },
  { key: "unknown", label: "Unknown item (confirmation required)", gp: 100 }
] as const;
export type PricingSlot = typeof PRICING_SLOTS[number]["key"];
const gp = z.number().int().min(0).max(100_000);
export const pricingSlotsSchema = z.object({
  armorLarge: gp, armorMedium: gp, accessory: gp, trinket: gp, oneHand: gp,
  offHand: gp, twoHand: gp, ranged: gp, relic: gp, utility: gp, legendary: gp, unknown: gp
}).strict();
export const pricingPolicySchema = z.object({
  preset: z.literal(PRICING_PRESET), edition: z.string().min(1).max(32), slots: pricingSlotsSchema
}).strict();
export type PricingPolicy = z.infer<typeof pricingPolicySchema>;
export const DECEMBER_RULES = {
  attendanceEp: 100, lateEp: 50, bossEp: 0, completionEp: 0, baseGp: 100,
  decayPercent: 0.1, lootMode: "PRIORITY", separatePool: true, offspecPercent: 50, minEp: 0
} as const;
export function decemberPricing(edition: string): PricingPolicy {
  return { preset: PRICING_PRESET, edition, slots: Object.fromEntries(PRICING_SLOTS.map(s => [s.key, s.gp])) as PricingPolicy["slots"] };
}
export function readPricingPolicy(value: unknown): PricingPolicy | null {
  const result = pricingPolicySchema.safeParse(value);
  return result.success ? result.data : null;
}
export const EQUIPMENT_SLOTS: Record<string, PricingSlot> = {
  INVTYPE_HEAD: "armorLarge", INVTYPE_CHEST: "armorLarge", INVTYPE_ROBE: "armorLarge", INVTYPE_LEGS: "armorLarge",
  INVTYPE_SHOULDER: "armorMedium", INVTYPE_HAND: "armorMedium", INVTYPE_WAIST: "armorMedium", INVTYPE_FEET: "armorMedium",
  INVTYPE_WRIST: "accessory", INVTYPE_NECK: "accessory", INVTYPE_CLOAK: "accessory", INVTYPE_FINGER: "accessory",
  INVTYPE_TRINKET: "trinket", INVTYPE_WEAPON: "oneHand", INVTYPE_WEAPONMAINHAND: "oneHand", INVTYPE_WEAPONOFFHAND: "oneHand",
  INVTYPE_SHIELD: "offHand", INVTYPE_HOLDABLE: "offHand", INVTYPE_2HWEAPON: "twoHand",
  INVTYPE_RANGED: "ranged", INVTYPE_RANGEDRIGHT: "ranged", INVTYPE_THROWN: "relic", INVTYPE_RELIC: "relic",
  INVTYPE_BAG: "utility", INVTYPE_QUIVER: "utility"
};
export interface PricingItem {
  edition: string; equipLoc?: string; quality?: number; subclass?: number;
  // Verified token mappings/utility exceptions only; never inferred from names.
  rewardSlots?: PricingSlot[]; utility?: boolean; legendaryFragment?: boolean;
}
export function quoteRaidItem(policy: PricingPolicy, item: PricingItem, offspecPercent = 100) {
  if (item.edition !== policy.edition) return null;
  let slot: PricingSlot = EQUIPMENT_SLOTS[item.equipLoc ?? ""] ?? "unknown";
  if (item.equipLoc === "INVTYPE_RANGEDRIGHT" && item.subclass === 19) slot = "relic";
  if (item.quality === 5 && slot !== "unknown") slot = "legendary";
  if (item.utility) slot = "utility";
  const baseGp = item.legendaryFragment ? 0 : item.rewardSlots?.length
    ? Math.max(...item.rewardSlots.map(key => policy.slots[key])) : policy.slots[slot];
  return { baseGp, gp: Math.floor(baseGp * Math.max(0, Math.min(100, offspecPercent)) / 100 + 0.5),
    slot, provisional: slot === "unknown" && !item.rewardSlots?.length && !item.legendaryFragment,
    source: item.rewardSlots?.length ? "reward" : "slot", preset: policy.preset, edition: policy.edition };
}

export function pricingForAddon(value: unknown, revision: number) {
  const policy = readPricingPolicy(value);
  return policy ? { ...policy, revision, equipment: EQUIPMENT_SLOTS } : null;
}
