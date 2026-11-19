import type { ChatInputCommandInteraction } from "discord.js";

// Fewer top-level commands: several small commands are mounted under one
// parent (`/character profession set`, `/raid wcl check`, ...). Each
// mounted command keeps its own builder and handler; the handler is given a
// view of the interaction that looks exactly like the old, separate command
// (same commandName, same subcommand), so none of them had to change.

// A parent can also take only some of a command's subcommands (`only` / `except`), or lift
// them to its own level under new names (`flat`): that is how the officer tools moved to /lead,
// /officer and /organize while their handlers still see `/raid create`, `/epgp decay` and so on.
// A `Group` builds a new subcommand group from picked subcommands of several old commands
// (or whole old commands without subcommands): `/officer reports inactive` is `/inactive`,
// `/officer reports remind` is `/games remind` (commands restructure, November 2026).

export type Handler = (interaction: ChatInputCommandInteraction) => Promise<void>;
type Json = Record<string, unknown> & { name: string; description: string; options?: Json[]; type?: number };
type Buildable = { name: string; toJSON(): unknown };

export interface Mount {
  /** The old command: its builder and handler. */
  command: Buildable;
  handler: Handler;
  /** Its name under the parent. Defaults to the old command name. */
  as?: string;
  /** Keep only these subcommands. */
  only?: string[];
  /** Leave out these subcommands. */
  except?: string[];
  /** Put these subcommands directly on the parent instead of in a group: old name -> new name. */
  flat?: Record<string, string>;
}

/** One subcommand of a `Group`: an old command's subcommand (`sub`), or the whole old command (no `sub`). */
export interface Pick {
  command: Buildable;
  handler: Handler;
  /** The old subcommand; leave out for an old command that has no subcommands. */
  sub?: string;
  /** Its name in the group. Defaults to `sub`, else the old command name. */
  as?: string;
  /** A shorter description (Discord's 4000-character limit per command). */
  description?: string;
}

/** A new subcommand group made of picked subcommands. */
export interface Group {
  group: string;
  description: string;
  picks: Pick[];
}

const isGroup = (mount: Mount | Group): mount is Group => "group" in mount;

/** The parent's own subcommands: a command whose subcommands sit directly on the parent. */
export interface Base {
  command: Buildable;
  handler: Handler;
  /** Leave out these subcommands (they live under another parent now). */
  except?: string[];
}

// `sub` set: a lifted subcommand, which the handler must see under its old name (null: none).
interface Route { legacy: string; handler: Handler; grouped: boolean; sub?: string | null }

const jsonOf = (command: Buildable): Json => {
  // Discord reads default_member_permissions on the top-level command only.
  const json = { ...(command.toJSON() as unknown as Json) };
  delete json["default_member_permissions"];
  return json;
};
const isGrouped = (json: Json) => (json.options ?? []).some((option) => option.type === 1);
const keep = (options: Json[], mount: { only?: string[]; except?: string[] }) =>
  options.filter((option) => (!mount.only || mount.only.includes(option.name)) && !mount.except?.includes(option.name));

function lifted(json: Json, flat: Record<string, string>): Json[] {
  return Object.entries(flat).map(([old, name]) => {
    const option = (json.options ?? []).find((entry) => entry.name === old && entry.type === 1);
    if (!option) throw new Error(`/${json.name} has no subcommand "${old}" to mount`);
    return { ...option, name };
  });
}

const pickName = (pick: Pick) => pick.as ?? pick.sub ?? pick.command.name;

// A picked subcommand, renamed: from the old command's subcommands, or the whole old command as one.
function pickedOption(pick: Pick): Json {
  const json = jsonOf(pick.command);
  let option: Json;
  if (pick.sub) {
    const found = (json.options ?? []).find((entry) => entry.name === pick.sub && entry.type === 1);
    if (!found) throw new Error(`/${json.name} has no subcommand "${pick.sub}" to pick`);
    option = { ...found };
  } else {
    if (isGrouped(json)) throw new Error(`/${json.name} has subcommands: pick one`);
    // Only what a subcommand may carry: the top-level fields (permissions, contexts...) stay behind.
    option = { name: json.name, description: json.description, type: 1, ...(json["description_localizations"] ? { description_localizations: json["description_localizations"] } : {}), ...(json.options ? { options: json.options } : {}) };
  }
  return { ...option, name: pickName(pick), ...(pick.description ? { description: pick.description } : {}) };
}

// Object with the same surface the top-level list needs (name + toJSON).
export class MergedCommand {
  readonly routes = new Map<string, Route>();
  private readonly base: Base | null;
  private defaultMemberPermissions: bigint | null = null;
  private descriptionLocalizations: Record<string, string> | null = null;
  private nameLocalizations: Record<string, string> | null = null;
  constructor(
    readonly name: string,
    private readonly description: string,
    private readonly mounts: (Mount | Group)[],
    base?: Base
  ) {
    this.base = base ?? null;
    const add = (name: string, route: Route) => {
      if (this.routes.has(name)) throw new Error(`/${this.name} mounts "${name}" twice`);
      this.routes.set(name, route);
    };
    for (const mount of mounts) {
      if (isGroup(mount)) {
        add(mount.group, { legacy: "", handler: async () => undefined, grouped: true });
        for (const pick of mount.picks) {
          pickedOption(pick);
          add(`${mount.group} ${pickName(pick)}`, { legacy: pick.command.name, handler: pick.handler, grouped: false, sub: pick.sub ?? null });
        }
        continue;
      }
      const json = jsonOf(mount.command);
      if (mount.flat) {
        lifted(json, mount.flat);
        for (const [old, name] of Object.entries(mount.flat)) add(name, { legacy: mount.command.name, handler: mount.handler, grouped: false, sub: old });
      } else {
        add(mount.as ?? mount.command.name, { legacy: mount.command.name, handler: mount.handler, grouped: isGrouped(json) });
      }
    }
  }

  /** Same as SlashCommandBuilder's: Discord hides the parent from members without these permissions. */
  setDefaultMemberPermissions(permissions: bigint): this {
    this.defaultMemberPermissions = permissions;
    return this;
  }

  /** Same as SlashCommandBuilder's: the parent's description in other languages. */
  setDescriptionLocalizations(localizations: Record<string, string>): this {
    this.descriptionLocalizations = localizations;
    return this;
  }

  /** The parent's name in other languages (lowercase, no spaces: Discord's command-name rules). */
  setNameLocalizations(localizations: Record<string, string>): this {
    this.nameLocalizations = localizations;
    return this;
  }

  toJSON(): Json {
    const options: Json[] = [];
    if (this.base) options.push(...keep(jsonOf(this.base.command).options ?? [], this.base));
    for (const mount of this.mounts) {
      if (isGroup(mount)) {
        options.push({ name: mount.group, description: mount.description, type: 2, options: mount.picks.map(pickedOption) });
        continue;
      }
      const json = jsonOf(mount.command);
      if (mount.flat) {
        options.push(...lifted(json, mount.flat));
        continue;
      }
      const grouped = isGrouped(json);
      options.push({ ...json, name: mount.as ?? mount.command.name, type: grouped ? 2 : 1, ...(grouped ? { options: keep(json.options ?? [], mount) } : {}) });
    }
    const permissions = this.defaultMemberPermissions === null ? {} : { default_member_permissions: this.defaultMemberPermissions.toString() };
    const localized = this.descriptionLocalizations ? { description_localizations: this.descriptionLocalizations } : {};
    const named = this.nameLocalizations ? { name_localizations: this.nameLocalizations } : {};
    return { name: this.name, ...named, description: this.description, ...localized, options, type: 1, ...permissions } as Json;
  }

  /** Which old command and subcommand an interaction on this parent means. */
  resolve(interaction: { options: { getSubcommand(required?: boolean): string | null; getSubcommandGroup(required?: boolean): string | null } }): { legacy: string; sub: string | null; handler: Handler } | null {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    if (group) {
      const picked = this.routes.get(`${group} ${sub}`);
      if (picked) return { legacy: picked.legacy, sub: picked.sub ?? null, handler: picked.handler };
      const route = this.routes.get(group);
      return route && route.legacy ? { legacy: route.legacy, sub, handler: route.handler } : null;
    }
    const route = sub ? this.routes.get(sub) : undefined;
    if (route && !route.grouped) return { legacy: route.legacy, sub: route.sub ?? null, handler: route.handler };
    if (this.base) return { legacy: this.base.command.name, sub, handler: this.base.handler };
    return null;
  }
}

export type AnyCommand = Buildable | MergedCommand;

/** An interaction that reports the old command name and subcommand. */
export function legacyView(interaction: ChatInputCommandInteraction, legacy: string, sub: string | null): ChatInputCommandInteraction;
export function legacyView<T extends { commandName: string; options: unknown }>(interaction: T, legacy: string, sub: string | null): T;
export function legacyView(interaction: { commandName: string; options: unknown }, legacy: string, sub: string | null): unknown {
  const options = new Proxy(interaction.options as object, {
    get(target, property) {
      if (property === "getSubcommand") {
        return (required = true) => {
          if (sub === null && required) throw new Error("No subcommand");
          return sub;
        };
      }
      if (property === "getSubcommandGroup") return () => null;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
  return new Proxy(interaction, {
    get(target, property) {
      if (property === "commandName") return legacy;
      if (property === "options") return options;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
}

/** Finds the old command and subcommand an interaction on `all` means. */
export function resolveCommand(
  all: AnyCommand[],
  interaction: { commandName: string; options: { getSubcommand(required?: boolean): string | null; getSubcommandGroup(required?: boolean): string | null } }
): { legacy: string; sub: string | null; handler: Handler | null; merged: boolean } {
  const command = all.find((entry) => entry.name === interaction.commandName);
  if (command instanceof MergedCommand) {
    const found = command.resolve(interaction);
    return found ? { ...found, merged: true } : { legacy: interaction.commandName, sub: null, handler: null, merged: true };
  }
  return { legacy: interaction.commandName, sub: interaction.options.getSubcommand(false), handler: null, merged: false };
}
