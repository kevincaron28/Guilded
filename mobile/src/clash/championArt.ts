import type { ImageSourcePropType } from "react-native";
import type { ClassKey } from "./types";

// The nine Champion paintings, owner approved 8 November 2026 (docs/plans/APP_TCG_ART.md). Original art made with the
// owner's own tools; bundled as WebP (full 640x480, card art window 624x240, square portrait 192x192, about 1 MB in
// all). Regenerate with docs/plans/app-tcg-art/make-champions.mjs. Metro needs literal require() paths, so the list is
// written out; tests/championArt checks it against the files on disk.

export interface ChampionArt { full: ImageSourcePropType; window: ImageSourcePropType; portrait: ImageSourcePropType }

/* eslint-disable @typescript-eslint/no-require-imports */
export const CHAMPION_ART: Record<ClassKey, ChampionArt> = {
  warrior: { full: require("../../assets/clash/champions/warrior.webp"), window: require("../../assets/clash/champions/warrior-window.webp"), portrait: require("../../assets/clash/champions/warrior-portrait.webp") },
  paladin: { full: require("../../assets/clash/champions/paladin.webp"), window: require("../../assets/clash/champions/paladin-window.webp"), portrait: require("../../assets/clash/champions/paladin-portrait.webp") },
  hunter: { full: require("../../assets/clash/champions/hunter.webp"), window: require("../../assets/clash/champions/hunter-window.webp"), portrait: require("../../assets/clash/champions/hunter-portrait.webp") },
  rogue: { full: require("../../assets/clash/champions/rogue.webp"), window: require("../../assets/clash/champions/rogue-window.webp"), portrait: require("../../assets/clash/champions/rogue-portrait.webp") },
  priest: { full: require("../../assets/clash/champions/priest.webp"), window: require("../../assets/clash/champions/priest-window.webp"), portrait: require("../../assets/clash/champions/priest-portrait.webp") },
  shaman: { full: require("../../assets/clash/champions/shaman.webp"), window: require("../../assets/clash/champions/shaman-window.webp"), portrait: require("../../assets/clash/champions/shaman-portrait.webp") },
  mage: { full: require("../../assets/clash/champions/mage.webp"), window: require("../../assets/clash/champions/mage-window.webp"), portrait: require("../../assets/clash/champions/mage-portrait.webp") },
  warlock: { full: require("../../assets/clash/champions/warlock.webp"), window: require("../../assets/clash/champions/warlock-window.webp"), portrait: require("../../assets/clash/champions/warlock-portrait.webp") },
  druid: { full: require("../../assets/clash/champions/druid.webp"), window: require("../../assets/clash/champions/druid-window.webp"), portrait: require("../../assets/clash/champions/druid-portrait.webp") }
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The art for a class, or null for neutral cards. */
export function championArt(cls: string): ChampionArt | null {
  return (CHAMPION_ART as Record<string, ChampionArt>)[cls] ?? null;
}
