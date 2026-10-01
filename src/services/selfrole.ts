import { PermissionFlagsBits } from "discord.js";

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
export function selfRoleProblem(role: { id: string; managed: boolean; permissions: bigint }, guildId: string): string | null {
  if (role.id === guildId) return "@everyone cannot be a self-assign role.";
  if (role.managed) return "Bot and integration roles cannot be self-assigned.";
  if ((role.permissions & DANGEROUS_PERMISSIONS) !== 0n) {
    return "That role has moderation/management permissions, so it cannot be self-assigned.";
  }
  return null;
}
