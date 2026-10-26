import { MessageFlags, type ChatInputCommandInteraction, type GuildMember, type MessageComponentInteraction, type ModalSubmitInteraction } from "discord.js";
import { hasPermission } from "../permissions.js";
import { currentGuildScope } from "../services/guild-scope.js";

type CoreInteraction = ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

// Each collector interaction carries its current member roles. Never reuse the
// opening command's authorization for a later button or modal submission.
export async function checkCoreAccess(interaction: CoreInteraction): Promise<boolean> {
  const member = interaction.member;
  const scope = currentGuildScope();
  let allowed = false;
  if (member && interaction.guild && (!scope || scope.guild.discordId === interaction.guild.id)) {
    if (Array.isArray(member.roles)) {
      const ids = new Set(member.roles);
      const current = {
        permissions: interaction.memberPermissions,
        roles: { cache: interaction.guild.roles.cache.filter(role => ids.has(role.id)) }
      };
      allowed = Boolean(current.permissions && hasPermission(current as GuildMember, "raidLeader"));
    } else allowed = hasPermission(member as GuildMember, "raidLeader");
  }
  if (allowed) return true;
  const response = { content: "Current Raid Leader access is required. / Un accès actuel de chef de raid est requis.", flags: MessageFlags.Ephemeral as const };
  if (interaction.deferred || interaction.replied) await interaction.followUp(response);
  else await interaction.reply(response);
  return false;
}
