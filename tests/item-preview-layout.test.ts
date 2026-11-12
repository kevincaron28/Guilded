import { describe, expect, it } from "vitest";
import { buildItemEmbed, buildPayload, formatMoney, PREVIEW_NAME } from "../src/services/item-preview-embed.js";
import { itemFacts } from "../src/services/blizzard-items.js";
import type { ItemDetails } from "../src/services/item-preview-data.js";

const full: ItemDetails = {
  name: "Helm of Valor", quality: 4, itemId: 123, source: "forever", iconUrl: "https://render.worldofwarcraft.com/x.jpg",
  summary: "Head · Plate",
  facts: { slot: "Head", type: "Plate", armor: "120 Armor", stats: ["+5 Strength", "+4 Stamina"], effects: ["Equip: Improves your hit chance by 1%."], binding: "Binds when picked up", itemLevel: 25, requiredLevel: 20, sellCopper: 12005 },
  fr: { name: "Heaume de vaillance", facts: { slot: "Tête", type: "Plaques", armor: "120 Armure", stats: ["+5 Force"], itemLevel: 25, requiredLevel: 20, sellCopper: 12005 } }
};

describe("item preview layout", () => {
  it("shows an item with many fields in a fixed order, nothing repeated", () => {
    const e = buildItemEmbed({ itemId: 123, name: "Helm", verified: true }, full);
    const lines = e.description!.split("\n");
    expect(lines[0]).toBe("**Epic** · Head · Plate");
    expect(lines[1]).toBe("120 Armor");
    expect(lines[2]).toBe("**Stats** +5 Strength · +4 Stamina");
    expect(lines[3]).toContain("Equip");
    expect(e.fields?.map(f => f.name)).toEqual(["Item level", "Requires", "Sells for"]);
    expect(e.fields?.[2]?.value).toBe("1g 20s 5c");
    expect(e.title).toBe("Helm of Valor");
    expect(e.thumbnail?.url).toContain("render.worldofwarcraft.com");
    expect(e.footer?.text).toBe("Guilded Items · Item 123 · Data: Blizzard");
    expect(e.description).not.toContain("Item ID");
  });
  it("is French on request", () => {
    const e = buildItemEmbed({ itemId: 123, name: "Helm", verified: true }, full, "fr");
    expect(e.title).toBe("Heaume de vaillance");
    expect(e.description).toContain("**Épique** · Tête · Plaques");
    expect(e.fields?.map(f => f.name)).toEqual(["Niveau d'objet", "Niveau requis", "Vente"]);
    expect(e.footer?.text).toBe("Objets Guilded · Objet n° 123 · Données : Blizzard");
  });
  it("omits empty fields for an item with few", () => {
    const e = buildItemEmbed({ itemId: 6948, name: "Hearthstone", verified: true }, { name: "Hearthstone", quality: 1, facts: { binding: "Binds when picked up" } });
    expect(e.description).toBe("**Common**\nBinds when picked up");
    expect(e.fields).toBeUndefined();
  });
  it("says plainly that an unknown item is unverified", () => {
    const e = buildItemEmbed({ itemId: null, name: "Mystery", verified: false }, null, "fr");
    expect(e.description).toContain("Non vérifié");
    expect(e.footer?.text).toContain("non vérifié");
    expect(e.fields).toBeUndefined();
  });
  it("sets the sender name and the logo avatar, https only", () => {
    expect(buildPayload([], { lang: "fr", siteUrl: "https://example.org/some/page" })).toMatchObject({ username: PREVIEW_NAME.fr, avatar_url: "https://example.org/brand/logo-400.png" });
    const bare = buildPayload([]);
    expect(bare.username).toBe("Guilded Items");
    expect(bare.avatar_url).toBeUndefined();
  });
  it("formats money and reads facts from Blizzard data", () => {
    expect(formatMoney(5)).toBe("5c");
    expect(formatMoney(10000)).toBe("1g");
    const facts = itemFacts({ level: 10, required_level: 1, inventory_type: { type: "HEAD", name: "Head" }, item_subclass: { name: "Plate" },
      preview_item: { sell_price: { value: 250 }, spells: [{ description: "Use: heal" }], binding: { name: "Binds when equipped" } } }, "en_US");
    expect(facts).toEqual({ slot: "Head", type: "Plate", effects: ["Use: heal"], itemLevel: 10, binding: "Binds when equipped", sellCopper: 250 });
  });
});
