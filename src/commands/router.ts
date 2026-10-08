import type { ChatInputCommandInteraction } from "discord.js";

// Fewer top-level commands: several small commands are mounted under one
// parent (`/character profession set`, `/raid wcl check`, ...). Each
// mounted command keeps its own builder and handler; the handler is given a
// view of the interaction that looks exactly like the old, separate command
// (same commandName, same subcommand), so none of them had to change.

export type Handler = (interaction: ChatInputCommandInteraction) => Promise<void>;
type Json = Record<string, unknown> & { name: string; description: string; options?: Json[]; type?: number };
type Buildable = { name: string; toJSON(): unknown };

export interface Mount {
  /** The old command: its builder and handler. */
  command: Buildable;
  handler: Handler;
  /** Its name under the parent. Defaults to the old command name. */
  as?: string;
}

interface Route { legacy: string; handler: Handler; grouped: boolean }

// Object with the same surface the top-level list needs (name + toJSON).
export class MergedCommand {
  readonly routes = new Map<string, Route>();
  private readonly base: Buildable | null;
  private readonly baseHandler: Handler | null;
  constructor(
    readonly name: string,
    private readonly description: string,
    private readonly mounts: Mount[],
    base?: { command: Buildable; handler: Handler }
  ) {
    this.base = base?.command ?? null;
    this.baseHandler = base?.handler ?? null;
    for (const mount of mounts) {
      const json = mount.command.toJSON() as unknown as Json;
      const grouped = (json.options ?? []).some((option) => option.type === 1);
      this.routes.set(mount.as ?? mount.command.name, { legacy: mount.command.name, handler: mount.handler, grouped });
    }
  }

  toJSON(): Json {
    const options: Json[] = [];
    if (this.base) options.push(...((this.base.toJSON() as unknown as Json).options ?? []));
    for (const mount of this.mounts) {
      const json = { ...(mount.command.toJSON() as unknown as Json) };
      const name = mount.as ?? mount.command.name;
      const grouped = (json.options ?? []).some((option) => option.type === 1);
      options.push({ ...json, name, type: grouped ? 2 : 1 });
    }
    return { name: this.name, description: this.description, options, type: 1 } as Json;
  }

  /** Which old command and subcommand an interaction on this parent means. */
  resolve(interaction: { options: { getSubcommand(required?: boolean): string | null; getSubcommandGroup(required?: boolean): string | null } }): { legacy: string; sub: string | null; handler: Handler } | null {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    if (group) {
      const route = this.routes.get(group);
      return route ? { legacy: route.legacy, sub, handler: route.handler } : null;
    }
    const route = sub ? this.routes.get(sub) : undefined;
    if (route && !route.grouped) return { legacy: route.legacy, sub: null, handler: route.handler };
    if (this.base && this.baseHandler) return { legacy: this.base.name, sub, handler: this.baseHandler };
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
