// Crafting from the phone (phone app 0.6.0): GET /api/v1/me/crafting?guild=&q= (who in my guild can make an item, my open
// requests) and POST /api/v1/me/craft-request. Server: src/services/mobile-crafting.ts.

export interface CraftableItem { itemKey: number; itemName: string; profession: string; crafters: string[] }
export interface CraftRequestRow { id: string; item: string; quantity: number; status: "OPEN" | "CLAIMED"; crafter: string | null; mine: boolean; createdAt: string }
export interface Crafting { items: CraftableItem[]; requests: CraftRequestRow[] }

const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") : [];
const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;

export function parseCrafting(body: unknown): Crafting {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    items: rows(data.items).flatMap((r) => typeof r.itemKey === "number" && str(r.itemName)
      ? [{ itemKey: r.itemKey, itemName: str(r.itemName)!, profession: str(r.profession) ?? "", crafters: (Array.isArray(r.crafters) ? r.crafters : []).filter((c): c is string => typeof c === "string" && !!c) }] : []),
    requests: rows(data.requests).flatMap((r) => str(r.id) && str(r.item) && (r.status === "OPEN" || r.status === "CLAIMED")
      ? [{ id: str(r.id)!, item: str(r.item)!, quantity: typeof r.quantity === "number" ? r.quantity : 1, status: r.status, crafter: str(r.crafter), mine: r.mine === true, createdAt: str(r.createdAt) ?? "" }] : [])
  };
}

/** The professions in the member's language (the server sends the one English name per profession). */
const PROFESSIONS: Record<string, string> = {
  alchemy: "Alchimie", blacksmithing: "Forge", enchanting: "Enchantement", engineering: "Ingénierie", leatherworking: "Travail du cuir",
  tailoring: "Couture", cooking: "Cuisine", "first aid": "Premiers soins", jewelcrafting: "Joaillerie", inscription: "Calligraphie", poisons: "Poisons", mining: "Minage"
};
export function professionLabel(name: string, lang: "en" | "fr"): string {
  return lang === "fr" ? PROFESSIONS[name.toLowerCase()] ?? name : name;
}

/** Sample guild: a search that answers made-up crafters, without calling the bot. */
export function sampleCrafting(query: string): Crafting {
  const all: CraftableItem[] = [
    { itemKey: 1, itemName: "Heavy Linen Bandage", profession: "First Aid", crafters: ["Aelira", "Mira"] },
    { itemKey: 2, itemName: "Major Healing Potion", profession: "Alchemy", crafters: ["Mira"] },
    { itemKey: 3, itemName: "Runecloth Bag", profession: "Tailoring", crafters: ["Cindra"] },
    { itemKey: 4, itemName: "Thorium Shells", profession: "Engineering", crafters: ["Borin"] }
  ];
  const q = query.trim().toLowerCase();
  return {
    items: q.length >= 2 ? all.filter((item) => item.itemName.toLowerCase().includes(q)) : [],
    requests: [{ id: "sample-req", item: "Runecloth Bag", quantity: 2, status: "CLAIMED", crafter: "Cindra", mine: true, createdAt: "2026-11-24T12:00:00Z" }]
  };
}
