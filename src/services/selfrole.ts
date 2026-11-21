import { PermissionFlagsBits } from "discord.js";
import { isPermissionRole, isPermissionRoleName, permissionRoles, type Permission } from "../permissions.js";

const DANGEROUS_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.ManageNicknames |
  PermissionFlagsBits.ManageGuildExpressions |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.MentionEveryone;

// Anyone can press a self-role button, so the role behind it must be harmless:
// otherwise an officer mistake (or a role edited later) hands out real power.
export function selfRoleProblem(role: { id: string; name?: string; managed: boolean; permissions: bigint }, guildId: string): string | null {
  if (role.id === guildId) return "@everyone cannot be a self-assign role.";
  if (role.managed) return "Bot and integration roles cannot be self-assigned.";
  if ((role.permissions & DANGEROUS_PERMISSIONS) !== 0n) {
    return "That role has moderation/management permissions, so it cannot be self-assigned.";
  }
  // A role that carries Guilded authority (Officer, Raid Leader, Class Leader (Warrior), ...) is never a self-role,
  // whatever Discord permissions it has: the bot treats it as that authority, by name or by the server's scoped role id.
  const name = role.name ?? "";
  if ((Object.keys(permissionRoles) as Permission[]).some((permission) => isPermissionRole(permission, { id: role.id, name }) || (name !== "" && isPermissionRoleName(permission, name)))) {
    return "That role grants Guilded authority (officer, raid or class leader), so it cannot be self-assigned.";
  }
  return null;
}
