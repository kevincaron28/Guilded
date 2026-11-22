import { FR_DESCRIPTIONS } from "./french-descriptions.js";

// The French command picker: Discord shows name and description localizations to members whose
// app is in French. Descriptions are looked up by their English text (french-descriptions.ts), so
// every subcommand and option gets French without per-file edits. Localizations already set on a
// command (french-names.ts, index.ts) win. Command and subcommand NAMES stay English for routing:
// Discord always sends the English name, and only a few top-level names get a French display name.

type Node = {
  name: string;
  description?: string;
  name_localizations?: Record<string, string>;
  description_localizations?: Record<string, string>;
  options?: Node[];
};

/** French display names for top-level commands that had none (lowercase, no spaces, Discord's rule). */
export const FRENCH_TOP_NAMES: Record<string, string> = {
  loot: "butin",
  dungeon: "donjon",
  bank: "banque",
  tag: "etiquette",
  community: "communaute"
};

function fill(node: Node, top: boolean): void {
  if (node.description && !node.description_localizations?.["fr"]) {
    const french = FR_DESCRIPTIONS[node.description];
    if (french) node.description_localizations = { ...node.description_localizations, fr: french };
  }
  if (top && !node.name_localizations?.["fr"] && FRENCH_TOP_NAMES[node.name]) {
    node.name_localizations = { ...node.name_localizations, fr: FRENCH_TOP_NAMES[node.name]! };
  }
  for (const child of node.options ?? []) fill(child, false);
}

/** Adds the French descriptions (and top-level names) to a command's JSON, in place. */
export function localizeCommandJson<T>(json: T): T {
  fill(json as unknown as Node, true);
  return json;
}

/** Makes a command's toJSON() return its French localizations too. */
export function withFrenchPicker<T extends { toJSON(): unknown }>(command: T): T {
  const original = command.toJSON.bind(command);
  (command as { toJSON(): unknown }).toJSON = () => localizeCommandJson(original());
  return command;
}
