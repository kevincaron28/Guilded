import type { ImageSourcePropType } from "react-native";

// Painted card art by set 1 card id, for every card type (units, spells, gear, standards). Owner approvals: the nine class
// Legendary units ("L9-WoW", 9 November 2026, assets in assets/clash/legendary/) and the 22 "E22" paintings (the other six
// Legendaries and the sixteen Epics, 9 November 2026, assets in assets/clash/cards/); docs/plans/APP_TCG_ART.md. Original art
// made with the owner's own tools; bundled as WebP (full 640x480, card art window 624x240). Regenerate with
// docs/plans/app-tcg-art/make-legendaries.mjs and make-card-art.mjs. Metro needs literal require() paths, so the list is
// written out; cardArt.test.ts checks it against the files on disk and the set data.

export interface CardArt { full: ImageSourcePropType; window: ImageSourcePropType }

/* eslint-disable @typescript-eslint/no-require-imports */
export const CARD_ART: Record<string, CardArt> = {
  "010": { full: require("../../assets/clash/cards/010.webp"), window: require("../../assets/clash/cards/010-window.webp") },
  "011": { full: require("../../assets/clash/legendary/011.webp"), window: require("../../assets/clash/legendary/011-window.webp") },
  "021": { full: require("../../assets/clash/cards/021.webp"), window: require("../../assets/clash/cards/021-window.webp") },
  "022": { full: require("../../assets/clash/legendary/022.webp"), window: require("../../assets/clash/legendary/022-window.webp") },
  "032": { full: require("../../assets/clash/cards/032.webp"), window: require("../../assets/clash/cards/032-window.webp") },
  "033": { full: require("../../assets/clash/legendary/033.webp"), window: require("../../assets/clash/legendary/033-window.webp") },
  "042": { full: require("../../assets/clash/legendary/042.webp"), window: require("../../assets/clash/legendary/042-window.webp") },
  "044": { full: require("../../assets/clash/cards/044.webp"), window: require("../../assets/clash/cards/044-window.webp") },
  "054": { full: require("../../assets/clash/legendary/054.webp"), window: require("../../assets/clash/legendary/054-window.webp") },
  "055": { full: require("../../assets/clash/cards/055.webp"), window: require("../../assets/clash/cards/055-window.webp") },
  "065": { full: require("../../assets/clash/cards/065.webp"), window: require("../../assets/clash/cards/065-window.webp") },
  "066": { full: require("../../assets/clash/legendary/066.webp"), window: require("../../assets/clash/legendary/066-window.webp") },
  "076": { full: require("../../assets/clash/cards/076.webp"), window: require("../../assets/clash/cards/076-window.webp") },
  "077": { full: require("../../assets/clash/legendary/077.webp"), window: require("../../assets/clash/legendary/077-window.webp") },
  "087": { full: require("../../assets/clash/cards/087.webp"), window: require("../../assets/clash/cards/087-window.webp") },
  "088": { full: require("../../assets/clash/legendary/088.webp"), window: require("../../assets/clash/legendary/088-window.webp") },
  "098": { full: require("../../assets/clash/cards/098.webp"), window: require("../../assets/clash/cards/098-window.webp") },
  "099": { full: require("../../assets/clash/legendary/099.webp"), window: require("../../assets/clash/legendary/099-window.webp") },
  "121": { full: require("../../assets/clash/cards/121.webp"), window: require("../../assets/clash/cards/121-window.webp") },
  "123": { full: require("../../assets/clash/cards/123.webp"), window: require("../../assets/clash/cards/123-window.webp") },
  "125": { full: require("../../assets/clash/cards/125.webp"), window: require("../../assets/clash/cards/125-window.webp") },
  "130": { full: require("../../assets/clash/cards/130.webp"), window: require("../../assets/clash/cards/130-window.webp") },
  "132": { full: require("../../assets/clash/cards/132.webp"), window: require("../../assets/clash/cards/132-window.webp") },
  "143": { full: require("../../assets/clash/cards/143.webp"), window: require("../../assets/clash/cards/143-window.webp") },
  "144": { full: require("../../assets/clash/cards/144.webp"), window: require("../../assets/clash/cards/144-window.webp") },
  "145": { full: require("../../assets/clash/cards/145.webp"), window: require("../../assets/clash/cards/145-window.webp") },
  "146": { full: require("../../assets/clash/cards/146.webp"), window: require("../../assets/clash/cards/146-window.webp") },
  "147": { full: require("../../assets/clash/cards/147.webp"), window: require("../../assets/clash/cards/147-window.webp") },
  "148": { full: require("../../assets/clash/cards/148.webp"), window: require("../../assets/clash/cards/148-window.webp") },
  "149": { full: require("../../assets/clash/cards/149.webp"), window: require("../../assets/clash/cards/149-window.webp") },
  "150": { full: require("../../assets/clash/cards/150.webp"), window: require("../../assets/clash/cards/150-window.webp") }
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The painting for a set card id, or null when that card has none yet. */
export function cardArt(cardId: string): CardArt | null {
  return CARD_ART[cardId] ?? null;
}
