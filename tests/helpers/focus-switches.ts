// Test helper for the PoE2 tracking switch (companion/active-games.mjs). Tests that exercise PoE2 tracking turn it on:
//   vi.mock("../companion/active-games.mjs", async (original) => poeTrackingOn(await original()));
export function poeTrackingOn(original: Record<string, unknown>) {
  return { ...original, ACTIVE_TRACKING: ["poe2"], POE_TRACKING_ENABLED: true, poeTrackingOn: (config: { poeEnabled?: unknown }) => config.poeEnabled === true };
}
