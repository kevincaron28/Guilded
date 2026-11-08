// Guilded's phone palette and type sizes (docs/plans/APP_REDESIGN.md, "Visual direction").
// Matches the website: dark ground, panel cards, gold accents, green scores.
export const colors = {
  bg: "#0b0c0b", panel: "#151714", line: "#282b25", text: "#f3f0e7", muted: "#aaa99f",
  gold: "#d5ad57", green: "#9fbd83", red: "#e0624f", ink: "#1b160c", error: "#e7b4a8"
} as const;

export const type = { body: 13, small: 11, title: 20 } as const;
