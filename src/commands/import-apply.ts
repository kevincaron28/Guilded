import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { createAddonImportService } from "../services/addon-import.js";
import { createAuditService } from "../services/audit.js";
import { followUpImport } from "../services/import-followup.js";
import { describeCalendar } from "../services/calendar-sync.js";
import type { RaidImportSummary } from "../services/raid-import.js";
import type { DungeonImportSummary } from "../services/dungeon-import.js";
import { formatDuration } from "../services/dungeon-rules.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { requireGuildContext } from "./context.js";

const importService = createAddonImportService(prisma);
const auditService = createAuditService(prisma);

export const importApplyCommand = new SlashCommandBuilder()
  .setName("import-apply")
  .setDescription("Apply a reviewed addon import to the DKP ledger.")
  .addStringOption((option) => option.setName("id").setDescription("Import (pick from the list)").setAutocomplete(true).setRequired(true));

// Dungeon runs in this import: accepted, points, records, rejections.
export function dungeonReport(summary: DungeonImportSummary): string {
  if (summary.results.length === 0 && summary.duplicates === 0 && summary.malformed === 0) return "";
  const lines = summary.results.map((run) => {
    if (!run.valid) return `• ${run.dungeonName}: **not counted** (${run.invalidReason})`;
    if (run.state !== "COMPLETED") return `• ${run.dungeonName}: ${run.state.toLowerCase()}, no points`;
    const time = run.durationSec !== null ? formatDuration(run.durationSec) : "?";
    const extras = [run.guildRecord ? "🏆 guild record" : "", run.personalRecords.length ? `${run.personalRecords.length} personal record(s)` : "",
      run.unlinked.length ? `not linked: ${run.unlinked.join(", ")}` : ""].filter(Boolean).join(", ");
    return `• ${run.dungeonName} in ${time}: ${run.points} points awarded in total${extras ? ` (${extras})` : ""}`;
  });
  if (summary.duplicates) lines.push(`• ${summary.duplicates} run(s) already imported, skipped`);
  if (summary.malformed) lines.push(`• ${summary.malformed} run(s) unreadable, skipped`);
  const text = `\n\n**Dungeon runs**\n${lines.join("\n")}`;
  return text.length > 700 ? `${text.slice(0, 690)}\n…` : text;
}

// One short block per in-game raid: which Discord raid it matched, how many
// attendance rows were written, and signup no-shows / walk-ins.
function raidReport(raids: RaidImportSummary[]): string {
  const lines = raids.map((raid) => {
    if (!raid.matchedRaidTitle) return `• **${raid.title}**: no Discord raid within 4 hours of its start, attendance not recorded.`;
    const parts = [`• **${raid.title}** → ${raid.matchedRaidTitle}: ${raid.recorded} attendance record(s).`];
    if (raid.noShows.length > 0) parts.push(`  Signed up but not seen: ${raid.noShows.join(", ")}`);
    if (raid.walkIns.length > 0) parts.push(`  Came without signing up: ${raid.walkIns.join(", ")}`);
    return parts.join("\n");
  });
  const text = lines.length > 0 ? `\n\n**Raids**\n${lines.join("\n")}` : "";
  // Discord replies are capped at 2000 characters.
  return text.length > 1500 ? `${text.slice(0, 1480)}\n…(truncated)` : text;
}

export async function executeImportApply(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
    await interaction.reply({ content: "Only officers can apply addon imports.", ephemeral: true });
    return;
  }
  const importId = interaction.options.getString("id", true);
  const result = await importService.apply(context.guildId, importId, interaction.user.id);
  await auditService.record({
    guildId: context.guildId,
    actorId: interaction.user.id,
    action: "IMPORT_APPLIED",
    entityId: importId,
    metadata: {
      transactionCount: result.transactions.length,
      epgpTransactionCount: result.epgpTransactions.length,
      readinessSnapshotCount: result.readinessSnapshots.length,
      attunementCount: result.attunements.length,
      skippedAlreadyImported: result.skipped
    }
  });
  const { autoLinked, calendar } = await followUpImport(interaction.guild, context.guildId, result);
  await interaction.reply({
    content: `Applied import \`${importId}\`: ${result.transactions.length} DKP transaction(s), `
      + (result.consumables ? `${result.consumables} consumable check(s), ` : "")
      + (result.crafting.recipeSets || result.crafting.cooldownSets ? `${result.crafting.recipes} recipe(s) from ${result.crafting.recipeSets} profession list(s) and ${result.crafting.cooldownSets} cooldown list(s), ` : "")
      + (result.reserves.applied ? `soft-reserve list updated (${result.reserves.entries} reserve(s)), ` : "")
      + (result.discovery.discovered ? `${result.discovery.discovered} new character(s) discovered${autoLinked.length ? ` (linked automatically: ${autoLinked.map((row) => `${row.character} to ${row.member}`).join(", ")})` : ""}${result.discovery.discovered > autoLinked.length ? `, ${result.discovery.discovered - autoLinked.length} waiting for /character claim` : ""}, ` : "")
      + `${result.epgpTransactions.length} EPGP transaction(s), ${result.readinessSnapshots.length} `
      + `readiness snapshot(s), and ${result.attunements.length} attunement update(s) recorded. `
      + `${result.skipped} ledger entr${result.skipped === 1 ? "y was" : "ies were"} already imported and skipped.`
      + (result.loot.recorded ? ` ${result.loot.recorded} in-game loot award(s) added to /loot history.` : "")
      + (result.loot.unmatched.length ? ` Loot for unlinked characters skipped: ${result.loot.unmatched.join(", ")}.` : "")
      + (result.voided ? ` ${result.voided} entr${result.voided === 1 ? "y" : "ies"} voided in game reversed.` : "")
      + (result.held.rows.length ? ` **${result.held.rows.length} entr${result.held.rows.length === 1 ? "y is" : "ies are"} on hold** (see \`/import held\`).` : "")
      + (result.rejected.length ? ` ${result.rejected.length} malformed row(s) were left out.` : "")
      + raidReport(result.raids)
      + (calendar && describeCalendar(calendar) ? `\n\n**Calendar**\n${describeCalendar(calendar)}` : "")
      + dungeonReport(result.dungeons),
    ephemeral: true
  });
}
