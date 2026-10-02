import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { createAuditService } from "../services/audit.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";

const auditService = createAuditService(prisma);

// Rows not seen in an upload for this long (the officer cleaned their saved data) drop off the list.
const STALE_MS = 30 * 86_400_000;
const MAX_SHOWN = 20;

export const importHeldCommand = new SlashCommandBuilder()
  .setName("import-held")
  .setDescription("Addon entries waiting to be imported, and why.")
  .addStringOption((option) => option.setName("dismiss").setDescription("Code of an entry to drop for good (it is never imported)"))
  .addStringOption((option) => option.setName("restore").setDescription("Code of a dismissed entry to try again on the next sync"));

const codeOf = (id: string) => id.slice(-6).toUpperCase();

const WHY: Record<string, { en: string; fr: string }> = {
  UNLINKED: { en: "character not linked to a member (`/character link`)", fr: "personnage non lié à un membre (`/character link`)" },
  NO_CORE: { en: "no raid core was chosen (`/guilded void` it, then award again after `/guilded core <name>`)", fr: "aucun core choisi (`/guilded void`, puis redonne après `/guilded core <nom>`)" },
  UNKNOWN_POOL: { en: "its raid core was deleted or has no point pool", fr: "son core a été supprimé ou n'a pas de pool de points" },
  NO_CORE_RAID: { en: "no core raid matched yet (imports after `/guilded end`)", fr: "aucun raid de core trouvé (s'importe après `/guilded end`)" }
};

export async function executeImportHeld(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
    await interaction.reply({ content: "Only officers can review held addon entries.", ephemeral: true });
    return;
  }
  const fr = (await guildService.getSettings(context.guildId))?.language === "fr";
  const dismiss = interaction.options.getString("dismiss")?.trim().toUpperCase();
  const restore = interaction.options.getString("restore")?.trim().toUpperCase();
  const all = await prisma.addonHeldEntry.findMany({ where: { guildId: context.guildId }, orderBy: { firstSeenAt: "asc" } });

  if (dismiss || restore) {
    const wanted = dismiss ?? restore;
    const matches = all.filter((row) => codeOf(row.id) === wanted && (dismiss ? !row.dismissedAt : !!row.dismissedAt));
    if (matches.length !== 1) throw new Error(fr ? `Aucune entrée avec le code ${wanted}. Vérifie la liste : /import held.` : `No entry with code ${wanted}. Check the list: /import held.`);
    const row = matches[0]!;
    await prisma.addonHeldEntry.update({
      where: { id: row.id },
      data: dismiss ? { dismissedAt: new Date(), dismissedBy: interaction.user.id } : { dismissedAt: null, dismissedBy: null }
    });
    await auditService.record({
      guildId: context.guildId, actorId: interaction.user.id, action: "IMPORT_APPLIED", entityId: row.id,
      metadata: { held: dismiss ? "dismissed" : "restored", kind: row.kind, sourceRef: row.sourceRef, character: row.character, detail: row.detail }
    });
    await interaction.reply({
      content: dismiss
        ? (fr ? `Entrée retirée : **${row.character}** ${row.detail}. Elle ne sera jamais importée (\`/import held restore:${wanted}\` pour revenir en arrière).`
          : `Dismissed: **${row.character}** ${row.detail}. It will never be imported (\`/import held restore:${wanted}\` to undo).`)
        : (fr ? `Entrée rétablie : **${row.character}** ${row.detail}. La prochaine synchronisation la réessaie.`
          : `Restored: **${row.character}** ${row.detail}. The next sync tries it again.`),
      ephemeral: true
    });
    return;
  }

  const waiting = all.filter((row) => !row.dismissedAt && Date.now() - row.lastSeenAt.getTime() < STALE_MS);
  const dismissed = all.filter((row) => row.dismissedAt).length;
  if (waiting.length === 0) {
    await interaction.reply({
      content: (fr ? "Aucune entrée de l'addon en attente : tout ce qui a été envoyé est importé." : "No addon entries are on hold: everything uploaded was imported.")
        + (dismissed ? (fr ? ` (${dismissed} retirée(s).)` : ` (${dismissed} dismissed.)`) : ""),
      ephemeral: true
    });
    return;
  }
  const lines = waiting.slice(0, MAX_SHOWN).map((row) =>
    `\`${codeOf(row.id)}\` **${row.character}** ${row.detail.slice(0, 80)} — ${(WHY[row.reason] ?? { en: row.reason, fr: row.reason })[fr ? "fr" : "en"]}`);
  const head = fr
    ? `**${waiting.length} entrée(s) de l'addon en attente.** Elles s'importent seules dès que la cause est réglée; \`/import held dismiss:<code>\` en retire une pour de bon.`
    : `**${waiting.length} addon entr${waiting.length === 1 ? "y is" : "ies are"} on hold.** Each imports by itself once its cause is fixed; \`/import held dismiss:<code>\` drops one for good.`;
  const more = waiting.length > MAX_SHOWN ? (fr ? `\n…et ${waiting.length - MAX_SHOWN} de plus.` : `\n…and ${waiting.length - MAX_SHOWN} more.`) : "";
  await interaction.reply({ content: `${head}\n${lines.join("\n")}${more}`.slice(0, 1950), ephemeral: true });
}
