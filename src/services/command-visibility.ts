import { PermissionFlagsBits, type Guild } from "discord.js";
import { isPermissionRole, type Permission } from "../permissions.js";

// Leader and officer commands are hidden from members with default_member_permissions
// (commands/index.ts HIDDEN_FROM_MEMBERS), but the bot's own check is by role name. A Raid Leader
// without Manage Events, or an Officer without Manage Server, can't see them until an admin
// allows the role in Server Settings > Integrations. This works out who is affected.

// Which command each bot role needs to see (only checked when the server has that command).
export const ROLE_COMMANDS: Record<string, readonly string[]> = {
  raidLeader: ["lead"],
  officer: ["lead", "officer", "organize"],
  guildMaster: ["lead", "officer", "organize"]
};

export interface VisibilityRole { id: string; name: string; permissions: bigint }
export interface VisibilityCommand { id: string; name: string; defaultMemberPermissions: bigint | null }
// Discord's overrides: keyed by command id, or by the application id for app-wide ones.
// type 1 = role, 2 = user, 3 = channel; a role id equal to the guild id is @everyone.
export interface VisibilityOverride { id: string; type: number; permission: boolean }

export interface BlockedRole { role: string; command: string }

// Discord's order: command-level role override, command-level @everyone, app-level role,
// app-level @everyone, then default_member_permissions. Channel overrides are ignored.
function roleCanSee(role: VisibilityRole, command: VisibilityCommand, guildId: string, appId: string, overrides: Map<string, VisibilityOverride[]>): boolean {
  if ((role.permissions & PermissionFlagsBits.Administrator) !== 0n) return true;
  const roleOverride = (scope: string, id: string) => overrides.get(scope)?.find((entry) => entry.type === 1 && entry.id === id);
  const decided = roleOverride(command.id, role.id) ?? roleOverride(command.id, guildId) ?? roleOverride(appId, role.id) ?? roleOverride(appId, guildId);
  if (decided) return decided.permission;
  const needed = command.defaultMemberPermissions;
  return needed === null || (role.permissions & needed) === needed;
}

export function blockedRoles(input: {
  guildId: string;
  appId: string;
  roles: VisibilityRole[];
  commands: VisibilityCommand[];
  overrides: Map<string, VisibilityOverride[]>;
}): BlockedRole[] {
  const blocked: BlockedRole[] = [];
  for (const role of input.roles) {
    const permission = (Object.keys(ROLE_COMMANDS) as Permission[]).find((key) => isPermissionRole(key, role));
    if (!permission) continue;
    for (const name of ROLE_COMMANDS[permission] ?? []) {
      const command = input.commands.find((entry) => entry.name === name);
      if (command && !roleCanSee(role, command, input.guildId, input.appId, input.overrides)) blocked.push({ role: role.name, command: name });
    }
  }
  return blocked;
}

// Reads the server's commands and their Integrations overrides (a bot token can read them, not
// write them). Null when Discord refuses or the bot isn't ready: callers then say "not checked".
export async function commandVisibility(guild: Guild): Promise<BlockedRole[] | null> {
  try {
    const appId = guild.client.application?.id ?? guild.client.user?.id;
    if (!appId) return null;
    const [commands, overrides] = await Promise.all([guild.commands.fetch(), guild.commands.permissions.fetch({})]);
    await guild.roles.fetch();
    return blockedRoles({
      guildId: guild.id,
      appId,
      roles: guild.roles.cache.map((role) => ({ id: role.id, name: role.name, permissions: role.permissions.bitfield })),
      commands: commands.map((command) => ({ id: command.id, name: command.name, defaultMemberPermissions: command.defaultMemberPermissions?.bitfield ?? null })),
      overrides: new Map([...overrides.entries()].map(([id, list]) => [id, list.map((entry) => ({ id: entry.id, type: Number(entry.type), permission: entry.permission }))]))
    });
  } catch {
    return null;
  }
}

export const formatBlocked = (blocked: BlockedRole[]): string =>
  blocked.map((entry) => `${entry.role} → /${entry.command}`).join(", ");
