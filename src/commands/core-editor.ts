import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type ChatInputCommandInteraction, type Message, type MessageComponentInteraction
} from "discord.js";
import type { RaidRole } from "@prisma/client";
import { prisma } from "../database.js";
import { coreRosterEmbed, createRaidCoreService, removeCoreRosterMessage, syncCoreRoster } from "../services/raid-core.js";
import { createItemValueService, parseItemValues, priceDraft } from "../services/item-values.js";
import { createCoreChannels, renameCoreDiscord } from "../services/core-channels.js";
import { pricesModal } from "./core-wizard.js";
import { guildService } from "./context.js";

// /core edit: change a raid core by clicking.
//   • pick how to add (Tank / Healer / DPS, on the main roster or the bench), then pick the players:
//     new players are added, players already in the core get that role or bench spot
//   • pick players to remove
//   • rename the core
// Every change is saved at once and the roster message in the roster channel is refreshed.

const coreService = createRaidCoreService(prisma);
const ROLE_LABEL: Record<RaidRole, string> = { TANK: "Tank", HEALER: "Healer", DPS: "DPS" };

// Shared with core-wizard.ts, whose roster step reuses this same role+bench picker.
export type EditMode = { role: RaidRole; bench: boolean };
export const modeKey = (mode: EditMode) => `${mode.role}${mode.bench ? "-bench" : ""}`;
export const parseMode = (value: string): EditMode => {
  const [role, bench] = value.split("-");
  return { role: (role === "TANK" || role === "HEALER" ? role : "DPS") as RaidRole, bench: bench === "bench" };
};

async function screen(guildId: string, coreId: string, mode: EditMode, note: string) {
  const core = await coreService.byIdOrName(guildId, coreId);
  const settings = await guildService.getSettings(guildId);
  const embed = coreRosterEmbed(core, settings?.lootMode).setTitle(`⚜️ Editing ${core.name}`).setDescription([
    core.description ?? "",
    "**1.** Choose how to add (role, main roster or bench). **2.** Pick the players. Players already in the core are moved to that role or spot.",
    "Use the red menu to remove players. Changes are saved at once.",
    note ? `\n**Last action:** ${note}` : ""
  ].filter(Boolean).join("\n"));
  const modeMenu = new StringSelectMenuBuilder().setCustomId("coreedit:mode").setPlaceholder("Adding as…").addOptions(
    (["TANK", "HEALER", "DPS"] as const).flatMap((role) => [
      { label: `${ROLE_LABEL[role]} (main roster)`, value: modeKey({ role, bench: false }), default: mode.role === role && !mode.bench },
      { label: `${ROLE_LABEL[role]} (bench, replacement)`, value: modeKey({ role, bench: true }), default: mode.role === role && mode.bench }
    ]));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeMenu),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId("coreedit:add").setPlaceholder(`➕ Add or move players as ${ROLE_LABEL[mode.role]}${mode.bench ? " (bench)" : ""}`).setMinValues(1).setMaxValues(25)),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId("coreedit:remove").setPlaceholder("➖ Remove players from this core").setMinValues(1).setMaxValues(25)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("coreedit:rename").setLabel("Rename").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("coreedit:prices").setLabel("Item prices").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("coreedit:channels").setLabel("Create channels & role").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("coreedit:done").setLabel("Done ✔").setStyle(ButtonStyle.Success))
    ]
  };
}

export async function runCoreEditor(interaction: ChatInputCommandInteraction, guildId: string, coreValue: string): Promise<void> {
  const core = await coreService.byIdOrName(guildId, coreValue);
  let mode: EditMode = { role: "DPS", bench: false };
  await interaction.reply({ ...(await screen(guildId, core.id, mode, "")), ephemeral: true });
  const message: Message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: 20 * 60_000, filter: (i) => i.user.id === interaction.user.id });

  const refresh = async (note: string) => {
    await syncCoreRoster(interaction.guild, prisma, guildId, core.id);
    await interaction.editReply(await screen(guildId, core.id, mode, note));
  };

  collector.on("collect", async (i: MessageComponentInteraction) => {
    try {
      if (i.customId === "coreedit:mode" && i.isStringSelectMenu()) {
        await i.deferUpdate();
        mode = parseMode(i.values[0] ?? "DPS");
        await interaction.editReply(await screen(guildId, core.id, mode, ""));
        return;
      }
      if (i.customId === "coreedit:add" && i.isUserSelectMenu()) {
        await i.deferUpdate();
        const names: string[] = [];
        for (const userId of i.values) {
          const person = await interaction.guild?.members.fetch(userId).catch(() => null);
          if (!person || person.user.bot) continue;
          const member = await guildService.ensureMember(guildId, userId, person.displayName);
          await coreService.addMember(guildId, core.id, member.id, mode.role, mode.bench);
          names.push(person.displayName);
        }
        await refresh(names.length ? `${names.join(", ")} → ${ROLE_LABEL[mode.role]}${mode.bench ? " (bench)" : ""}.` : "Nobody added (bots are skipped).");
        return;
      }
      if (i.customId === "coreedit:remove" && i.isUserSelectMenu()) {
        await i.deferUpdate();
        const removed: string[] = [];
        for (const userId of i.values) {
          const person = await interaction.guild?.members.fetch(userId).catch(() => null);
          const member = await prisma.member.findFirst({ where: { guildId, discordUserId: userId } });
          if (!member) continue;
          const result = await prisma.raidCoreMember.deleteMany({ where: { coreId: core.id, memberId: member.id } });
          if (result.count > 0) removed.push(person?.displayName ?? member.displayName);
        }
        await refresh(removed.length ? `Removed ${removed.join(", ")}.` : "None of them were in this core.");
        return;
      }
      if (i.customId === "coreedit:channels" && i.isButton()) {
        // The core's role, category and channels (safe to press again: only what is missing).
        await i.deferUpdate();
        if (!interaction.guild) return;
        try {
          const before = await prisma.raidCore.findUniqueOrThrow({ where: { id: core.id } });
          const created = await createCoreChannels(interaction.guild, prisma, core.id);
          const old = await prisma.raidCore.findUnique({ where: { id: core.id } });
          // The roster message moved: the one left in the shared roster channel is removed.
          if (old && before.rosterChannelId !== old.rosterChannelId) {
            await removeCoreRosterMessage(interaction.guild, prisma, guildId, before.rosterMessageId, before.rosterChannelId);
          }
          await refresh(created.length ? `Created ${created.join(", ")}. The roster moved to the core's own channel; its raids post in its signups channel.` : `Everything already exists${old?.rosterChannelId ? ` (<#${old.rosterChannelId}>)` : ""}.`);
        } catch (error) {
          await refresh(error instanceof Error ? error.message : "Could not create the channels.");
        }
        return;
      }
      if (i.customId === "coreedit:prices" && i.isButton()) {
        // The same prefilled list as /core setup: current prices, then missing ones with suggestions.
        await i.showModal(pricesModal(core, (await priceDraft(prisma, guildId, core.id)).text));
        const submitted = await i.awaitModalSubmit({ time: 10 * 60_000, filter: (m) => m.user.id === i.user.id }).catch(() => null);
        if (!submitted) return;
        try {
          const parsed = parseItemValues(submitted.fields.getTextInputValue("prices"));
          if (parsed.values.length === 0) throw new Error(parsed.problems[0] ?? "No prices found. Use one line per item: Sulfuras = 250");
          const saved = await createItemValueService(prisma).setMany(guildId, core.id, parsed.values);
          await submitted.deferUpdate();
          await refresh(`Saved ${saved} price(s).${parsed.problems.length ? ` Skipped: ${parsed.problems.slice(0, 2).join("; ")}` : ""}`);
        } catch (error) {
          await submitted.reply({ content: error instanceof Error ? error.message : "Could not save the prices.", ephemeral: true });
        }
        return;
      }
      if (i.customId === "coreedit:rename" && i.isButton()) {
        const current = await prisma.raidCore.findUniqueOrThrow({ where: { id: core.id } });
        await i.showModal(new ModalBuilder().setCustomId("coreedit:rename-modal").setTitle("Rename raid core").addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Name").setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(50).setRequired(true).setValue(current.name)),
          new ActionRowBuilder<TextInputBuilder>().addComponents((() => {
            const field = new TextInputBuilder().setCustomId("description").setLabel("Description (optional)").setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false);
            if (current.description) field.setValue(current.description);
            return field;
          })())));
        const submitted = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.user.id === i.user.id }).catch(() => null);
        if (!submitted) return;
        try {
          const renamed = await coreService.rename(guildId, core.id, submitted.fields.getTextInputValue("name"), submitted.fields.getTextInputValue("description"));
          const name = renamed.name;
          if (interaction.guild) await renameCoreDiscord(interaction.guild, renamed);
          await submitted.deferUpdate();
          await refresh(`Renamed to ${name}.`);
        } catch (error) {
          await submitted.reply({ content: error instanceof Error ? error.message : "Could not rename.", ephemeral: true });
        }
        return;
      }
      if (i.customId === "coreedit:done") {
        await i.update({ content: "✅ Saved. The roster message is up to date.", embeds: [], components: [] });
        collector.stop("closed");
      }
    } catch (error) {
      console.error("Core editor step failed", error);
      const text = error instanceof Error ? error.message : String(error);
      if (!i.replied && !i.deferred) await i.reply({ content: `That didn't work: ${text}`, ephemeral: true }).catch(() => undefined);
      else await i.followUp({ content: `That didn't work: ${text}`, ephemeral: true }).catch(() => undefined);
    }
  });
  collector.on("end", async (_c, reason) => {
    if (reason !== "closed") await interaction.editReply({ content: "The editor timed out. Everything you changed was saved; run /core edit again to continue.", embeds: [], components: [] }).catch(() => undefined);
  });
}
