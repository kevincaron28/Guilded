import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { createItemValueService, describeValues, parseItemValues } from "../services/item-values.js";
import { createRaidCoreService } from "../services/raid-core.js";
import { coreContext } from "../services/core-context.js";
import { CORE_REQUIRED } from "../services/core-loot-policy.js";

const values = createItemValueService(prisma);
const coreService = createRaidCoreService(prisma);
const MAX_BYTES = 200_000;

// /core items: the set GP prices used by EPGP priority loot. Raid Leaders only (checked by the caller).
export async function executeCoreItems(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const action = interaction.options.getString("action", true);
  const coreName = interaction.options.getString("core");
  const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
  const core = coreName ? await coreService.byIdOrName(guildId, coreName) : settings?.coreLootOnly ? await coreContext(prisma, guildId, interaction.channelId) : null;
  if (settings?.coreLootOnly && !core) throw new Error(CORE_REQUIRED);
  const scope = core ? `**${core.name}**` : "the whole guild";
  const coreId = core?.id ?? null;

  if (action === "list") {
    // A core shows what it actually uses: the guild-wide prices with its own on top.
    const rows = core ? await values.effective(guildId, core.id) : await values.list(guildId, null);
    await interaction.reply({ content: describeValues(core ? `${core.name} prices${settings?.coreLootOnly ? "" : " (guild-wide ones included)"}` : "Guild-wide prices", rows), ephemeral: true });
    return;
  }

  if (action === "set" || action === "remove") {
    const item = interaction.options.getString("item");
    if (!item) throw new Error("Give the item name (or its id) in the item option.");
    if (action === "remove") {
      const parsed = parseItemValues(`${item} = 0`).values[0];
      if (!parsed) throw new Error("That does not look like an item name.");
      const removed = await values.remove(guildId, coreId, parsed);
      await interaction.reply({ content: removed ? `Removed the price of ${item} for ${scope}.` : `${item} had no price set for ${scope}.`, ephemeral: true });
      return;
    }
    const gp = interaction.options.getInteger("gp");
    if (gp === null) throw new Error("Give the price in the gp option.");
    const parsed = parseItemValues(`${item} = ${gp}`);
    if (parsed.values.length === 0) throw new Error(parsed.problems[0] ?? "That does not look like an item name.");
    await values.setMany(guildId, coreId, parsed.values);
    await interaction.reply({ content: `${item} costs **${gp} GP** for ${scope}.`, ephemeral: true });
    return;
  }

  if (action === "clear") {
    const removed = await values.clear(guildId, coreId);
    await interaction.reply({ content: `Removed ${removed} price(s) for ${scope}.`, ephemeral: true });
    return;
  }

  if (action === "import") {
    const file = interaction.options.getAttachment("file");
    if (!file) throw new Error("Attach a text or CSV file with one \"item = price\" per line.");
    if (file.size > MAX_BYTES) throw new Error("That file is too big for a price list.");
    await interaction.deferReply({ ephemeral: true });
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Could not download the file (${response.status}).`);
    const parsed = parseItemValues(await response.text());
    if (parsed.values.length === 0) throw new Error(parsed.problems[0] ?? "No prices found in that file.");
    const changed = await values.setMany(guildId, coreId, parsed.values);
    await interaction.editReply({
      content: `Saved ${changed} price(s) for ${scope}.${parsed.problems.length ? `\n${parsed.problems.slice(0, 5).join("\n")}${parsed.problems.length > 5 ? `\n…and ${parsed.problems.length - 5} more lines skipped.` : ""}` : ""}`
    });
    return;
  }
  throw new Error("Unknown action.");
}
