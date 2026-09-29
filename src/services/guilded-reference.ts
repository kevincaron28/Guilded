import type { AnyCommand } from "../commands/router.js";

const ADDON_REFERENCE = `In-game addon:
- All addon slash commands start with /guilded. Run /guilded help for the complete list available to this character, /guilded options for the addon settings, and /guilded minimap show|hide|reset for its minimap button. Optional features can be enabled with /guilded modules on|off <module>; officers can set guild-wide switches with /guilded modules guild on|off <module>.
- Sync and characters: /guilded sync | sync status; /guilded peers shows addon versions in the current session. Guild data syncs between Guilded addons over the WoW Guild channel. The separate Companion desktop tray app uploads saved Guilded.lua SavedVariables after logout or /reload. Link Discord and game characters with /character pair or /character import. /guilded backup and /guilded restore [undo|forget] copy or restore this guild's saved data.
- Raids and loot: /guilded bid start <min GP> <item> [seconds] | close | award | cancel | status for GP bidding; /guilded council start <item> [seconds] | close | award [player] [GP] | cancel | status for loot council; /guilded reserve <item link> for soft reserves (officers open, lock, roll and award); /guilded drop <item link> [seconds] starts loot using the selected raid core's system; /guilded core [name] picks that core; /guilded price <item> <GP> sets an item price; /guilded drops [number|clear] tracks raid drops and trades owed. Ask an officer about this guild's loot rules.
- Raids and group utility: /guilded ready [ask|post|settings|require <check> on|off] handles readiness (checks also run automatically); /guilded consumes shows missing raid consumables; /guilded invite raid|missing invites players signed up on Discord; officer /guilded autoinvite on [phrase]|off|status configures phrase invites; /guilded calendar check|sync|list|create syncs the game calendar with Discord; /guilded rt opens raid target/tank marking and boss plans; /guilded sim lets officers test flows with fake players.
- Characters and professions: /guilded recipes who <item> finds guild crafters; /guilded cooldowns shows profession cooldowns. The addon also tracks character readiness, consumables and attunements.
- Dungeons and groups: /guilded dungeon status|start|complete|abandon|check tracks a run; /guilded score [player|top] shows scores from recorded runs; /guilded lfg opens the in-game group board. /guilded games offers highroll, deathroll and duel with no gold or ledger.
- Guild map sharing: /guilded map share on|off controls sending your own outdoor position; /guilded map show on|off controls showing guildmates. Positions do not appear in instances; dots disappear when a player stops sharing and expire if they stop sending updates.
- Other convenience commands: /guilded digest [on|off] shows what changed since the previous login; /guilded chat tab|off displays Guilded messages in a separate chat tab.`;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function commandLines(name: string, description: string, options: unknown[]): string[] {
  const lines = [`/${name} — ${description}`];
  for (const rawOption of options) {
    const option = object(rawOption);
    if (!option) continue;
    const optionName = text(option["name"]);
    if (!optionName) continue;
    const optionDescription = text(option["description"]) ?? "";
    const nested = Array.isArray(option["options"]) ? option["options"] : [];
    const type = option["type"];
    if (type === 1 || type === 2) {
      lines.push(...commandLines(`${name} ${optionName}`, optionDescription, nested));
    } else {
      const required = option["required"] === true ? " (required)" : "";
      const choices = Array.isArray(option["choices"])
        ? option["choices"].map((choice) => text(object(choice)?.["name"])).filter((choice): choice is string => choice !== null).join(", ")
        : "";
      lines.push(`  ${optionName}${required}: ${optionDescription}${choices ? ` [${choices}]` : ""}`);
    }
  }
  return lines;
}

export function buildGuildedReference(commands: readonly AnyCommand[]): string {
  const lines = [ADDON_REFERENCE, "", "Discord slash commands (options and permissions can depend on your role):"];
  const maxLength = 14_000;
  let truncated = false;
  let length = lines.join("\n").length;
  for (const command of commands) {
    const data = object(command.toJSON());
    if (!data) continue;
    const name = text(data["name"]) ?? command.name;
    const description = text(data["description"]) ?? "";
    const options = Array.isArray(data["options"]) ? data["options"] : [];
    for (const line of commandLines(name, description, options)) {
      if (length + line.length + 1 > maxLength - 100) {
        truncated = true;
        break;
      }
      lines.push(line);
      length += line.length + 1;
    }
    if (truncated) break;
  }
  if (truncated) lines.push("[Command reference truncated; use /help or /guilded help for the full list.]");
  return lines.join("\n");
}
