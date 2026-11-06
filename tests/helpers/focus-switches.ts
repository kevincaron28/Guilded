// Test helpers for the Forever-only focus (companion/active-editions.mjs, companion/active-games.mjs).
// Tests that exercise other WoW editions or PoE2 tracking turn those switches on with vi.mock, e.g.
//   vi.mock("../companion/active-editions.mjs", async (original) => allEditionsOn(await original()));
const ALL = ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"];

type Mod = Record<string, unknown> & {
  activeEditions: (active?: readonly string[]) => string[]; heldEditions: (active?: readonly string[]) => string[];
  editionList: (lang: 0 | 1, active?: readonly string[], joiner?: string[]) => string;
  isFolderOnHold: (name: string, active?: readonly string[]) => boolean;
};

export function allEditionsOn(original: Mod) {
  return {
    ...original,
    ACTIVE_EDITIONS: ALL,
    isEditionActive: (edition: string, active: readonly string[] = ALL) => active.includes(edition),
    activeEditions: (active: readonly string[] = ALL) => original.activeEditions(active),
    heldEditions: (active: readonly string[] = ALL) => original.heldEditions(active),
    editionList: (lang: 0 | 1, active: readonly string[] = ALL, joiner?: string[]) => original.editionList(lang, active, joiner),
    isFolderOnHold: (name: string, active: readonly string[] = ALL) => original.isFolderOnHold(name, active)
  };
}

export function poeTrackingOn(original: Record<string, unknown>) {
  return { ...original, ACTIVE_TRACKING: ["poe2"], POE_TRACKING_ENABLED: true, poeTrackingOn: (config: { poeEnabled?: unknown }) => config.poeEnabled === true };
}
