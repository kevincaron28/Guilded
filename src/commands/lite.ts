// Guilded Lite: what a hosted server can use while it waits for the owner's approval.
// Each entry names a top-level command and the subcommands or groups it keeps (null: all of
// it), with any options removed. Approving the server registers the full command list.
type Json = Record<string, unknown> & { name: string; options?: Json[] };
type Buildable = { name: string; toJSON(): unknown };

export const LITE_COMMANDS: Record<string, null | Record<string, string[]>> = {
  setup: { start: [] },
  help: null,
  report: { bug: [], ping: [] },
  mod: { faq: [] },
  dungeon: { group: [] },
  // Basic signups: no raid cores, weekly repeats, EP, attendance or seasons.
  raid: { signup: [], "cancel-signup": [], status: [], roster: [] },
  lead: { create: ["core", "weekly"], edit: [], cancel: [] }
};

/** The Lite command set, ready for Discord's bulk-overwrite endpoint. */
export function liteCommandJson(commands: Buildable[]): Json[] {
  return commands.flatMap((command) => {
    const keep = LITE_COMMANDS[command.name];
    if (keep === undefined) return [];
    const json = command.toJSON() as Json;
    if (keep === null) return [json];
    const options = (json.options ?? []).filter((option) => option.name in keep)
      .map((option) => ({ ...option, options: (option.options ?? []).filter((inner) => !keep[option.name]!.includes(inner.name)) }));
    return [{ ...json, options }];
  });
}

/** Whether a Lite server may run this slash command (or its autocomplete). */
export function allowsLite(commandName: string, group: string | null, sub: string | null): boolean {
  const keep = LITE_COMMANDS[commandName];
  if (keep === undefined) return false;
  if (keep === null) return true;
  const first = group ?? sub;
  return first !== null && first in keep;
}

/** Wizard steps a Lite server sees in /setup start: language, roles and channels, then the checklist. */
export const LITE_SETUP_STEPS = [0, 1, 2, 3, 4, 8];

/** What Lite includes, for the welcome post (both languages: the server language is not chosen yet). */
export const LITE_SUMMARY = {
  en: "Until the Guilded owner approves this server: `/setup start` (roles and channels), `/help`, `/mod faq`, `/report bug`, `/dungeon group` and basic raid signups (`/lead create`, `/raid signup`). Approval unlocks everything else (addon sync, EPGP, seasons, guild page).",
  fr: "En attendant l'approbation du propriétaire de Guilded : `/setup start` (rôles et salons), `/help`, `/mod faq`, `/report bug`, `/dungeon group` et les inscriptions de raid simples (`/lead create`, `/raid signup`). L'approbation débloque tout le reste (synchronisation de l'addon, EPGP, saisons, page de guilde)."
};

/** The command list to register for a server's pilot tier (null: none, the server has no access). */
export function commandSetFor(tier: "approved" | "lite" | "blocked", commands: Buildable[]): unknown[] | null {
  if (tier === "blocked") return null;
  return tier === "lite" ? liteCommandJson(commands) : commands.map((command) => command.toJSON());
}
