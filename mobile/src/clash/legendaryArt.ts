import type { ImageSourcePropType } from "react-native";

// The nine Legendary class unit paintings (the "L9-WoW" set, owner approved 9 November 2026; docs/plans/APP_TCG_ART.md),
// keyed by set 1 card id. Original art made with the owner's own tools; bundled as WebP (full 640x480, card art window
// 624x240). Regenerate with docs/plans/app-tcg-art/make-legendaries.mjs. Metro needs literal require() paths, so the list
// is written out; legendaryArt.test.ts checks it against the files on disk and the set data.

export interface LegendaryArt { full: ImageSourcePropType; window: ImageSourcePropType }

/* eslint-disable @typescript-eslint/no-require-imports */
export const LEGENDARY_ART: Record<string, LegendaryArt> = {
  "011": { full: require("../../assets/clash/legendary/011.webp"), window: require("../../assets/clash/legendary/011-window.webp") },
  "022": { full: require("../../assets/clash/legendary/022.webp"), window: require("../../assets/clash/legendary/022-window.webp") },
  "033": { full: require("../../assets/clash/legendary/033.webp"), window: require("../../assets/clash/legendary/033-window.webp") },
  "042": { full: require("../../assets/clash/legendary/042.webp"), window: require("../../assets/clash/legendary/042-window.webp") },
  "054": { full: require("../../assets/clash/legendary/054.webp"), window: require("../../assets/clash/legendary/054-window.webp") },
  "066": { full: require("../../assets/clash/legendary/066.webp"), window: require("../../assets/clash/legendary/066-window.webp") },
  "077": { full: require("../../assets/clash/legendary/077.webp"), window: require("../../assets/clash/legendary/077-window.webp") },
  "088": { full: require("../../assets/clash/legendary/088.webp"), window: require("../../assets/clash/legendary/088-window.webp") },
  "099": { full: require("../../assets/clash/legendary/099.webp"), window: require("../../assets/clash/legendary/099-window.webp") }
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The painting for a set card id, or null when that card has none yet. */
export function legendaryArt(cardId: string): LegendaryArt | null {
  return LEGENDARY_ART[cardId] ?? null;
}
