import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  UserSelectMenuBuilder, type ChatInputCommandInteraction, type Message, type MessageComponentInteraction
} from "discord.js";
import type { RaidCore, RaidRole } from "@prisma/client";
import { prisma } from "../database.js";
import { asLootMode, describeRules, effectiveRules, LOOT_MODE_HELP, LOOT_MODE_LABEL, LOOT_MODES } from "../services/core-rules.js";
import { createItemValueService, parseItemValues, priceDraft } from "../services/item-values.js";
import { coreRosterEmbed, createRaidCoreService, ensureCoreDiscord, syncCoreRoster } from "../services/raid-core.js";
import { CORE_LOOT_LABEL, modeKey, parseMode, type EditMode } from "./core-editor.js";
import { guildService } from "./context.js";
import { fillCoreWeeklyRaids } from "../services/core-weekly-raids.js";
import { parseWeeklySchedule } from "../services/core-weekly-time.js";

// /core setup: build a raid core by clicking, not by remembering commands.
//   1. name it (a small form)          2. pick its tanks, healers and DPS (main roster or bench)
//   3. rules: same as the guild (default), or its own point pool / loot council / EP values
// Everything is saved as you go; closing the message loses nothing.

const coreService = createRaidCoreService(prisma);
const itemValues = createItemValueService(prisma);
const ROLE_LABEL: Record<RaidRole, string> = { TANK: "Tanks", HEALER: "Healers", DPS: "DPS" };
const MODE_ROLE_LABEL: Record<RaidRole, string> = { TANK: "Tank", HEALER: "Healer", DPS: "DPS" };

const btn = (id: string, label: string, style: ButtonStyle = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(`corewiz:${id}`).setLabel(label).setStyle(style);

function nameStep() {
  const embed = new EmbedBuilder().setColor(0xd4af37).setTitle("⚜️ New raid core — step 1 of 3: name it")
    .setDescription([
      "A **raid core** is a named roster (for example *Tuesday Molten Core*). Its members get **priority at signups** for that core's raids, and its roster shows live in the raid roster channel.",
      "You can make as many cores as you like.",
      "",
      "Press **Name your core** and type a name."
    ].join("\n"));
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn("name", "Name your core", ButtonStyle.Primary), btn("cancel", "Cancel"))] };
}

async function rosterStep(core: { id: string; name: string; description: string | null }, guildId: string, note: string, mode: EditMode) {
  const full = await coreService.byIdOrName(guildId, core.id);
  const settings = await guildService.getSettings(guildId);
  const embed = coreRosterEmbed(full, settings?.lootMode).setTitle(`⚜️ ${core.name} — step 2 of 3: pick the players`)
    .setDescription([
      "Pick a role below (main roster or bench/reserve), then pick the players. Each pick is saved at once; use the menus again to add more.",
      "To change someone's role or remove them later: `/core edit`.",
      note ? `\n**Last action:** ${note}` : ""
    ].join("\n"));
  const modeMenu = new StringSelectMenuBuilder().setCustomId("corewiz:mode").setPlaceholder("Adding as…").addOptions(
    (["TANK", "HEALER", "DPS"] as const).flatMap((role) => [
      { label: `${MODE_ROLE_LABEL[role]} (main roster)`, value: modeKey({ role, bench: false }), default: mode.role === role && !mode.bench },
      { label: `${MODE_ROLE_LABEL[role]} (bench, reserve)`, value: modeKey({ role, bench: true }), default: mode.role === role && mode.bench }
    ]));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeMenu),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId("corewiz:add").setPlaceholder(`➕ Add players as ${MODE_ROLE_LABEL[mode.role]}${mode.bench ? " (bench)" : ""}`).setMinValues(1).setMaxValues(25)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(btn("rules", "Next: rules ▶", ButtonStyle.Primary), btn("finish", "Skip rules, finish", ButtonStyle.Success))
    ]
  };
}

async function rulesStep(coreId: string, guildId: string, note: string) {
  const core = await prisma.raidCore.findUniqueOrThrow({ where: { id: coreId } });
  const settings = await guildService.getSettings(guildId);
  const rules = effectiveRules(settings, core);
  const guildMode = asLootMode(settings?.lootMode);
  const priced = rules.lootMode === "PRIORITY" ? await itemValues.effective(guildId, core.id) : [];
  const embed = new EmbedBuilder().setColor(0xd4af37).setTitle(`⚜️ ${core.name} — step 3 of 3: rules`)
    .setDescription([
      settings?.coreLootOnly ? "Chaque core choisit **sa méthode de butin** et garde ses propres EP/GP. Aucun pot de points partagé entre les cores." : "By default a core follows **the guild's rules** (EP values, loot, points), exactly like every other core. Change only what should differ.",
      "",
      describeRules(rules, core.name),
      `\n**Loot system:** ${LOOT_MODE_HELP[rules.lootMode]}`,
      rules.lootMode === "PRIORITY" ? `**Item prices:** ${priced.length} set${priced.length ? "" : " (none yet: press Item prices)"}. Prices are also managed with \`/core items\`.` : "",
      note ? `\n**Last action:** ${note}` : ""
    ].filter(Boolean).join("\n"));
  const menu = new StringSelectMenuBuilder().setCustomId("corewiz:lootmode").setPlaceholder("How is loot decided in this core?").addOptions(
    ...(settings?.coreLootOnly ? [] : [{ label: `Follow the guild (${LOOT_MODE_LABEL[guildMode]})`.slice(0, 100), value: "DEFAULT", default: !core.lootMode }]),
    ...LOOT_MODES.map((mode) => ({ label: CORE_LOOT_LABEL[mode], value: mode, default: core.lootMode === mode })));
  const buttons = [
    btn("ep", "Change EP values"),
    ...(settings?.coreLootOnly ? [] : [btn("pool", core.separatePool ? "Own point pool: ON" : "Own point pool: off", core.separatePool ? ButtonStyle.Success : ButtonStyle.Secondary)])
  ];
  // Prices are used by EPGP priority loot and by /loot award when the GP is left out, so they
  // can be set whatever the loot system.
  buttons.push(btn("prices", "Item prices", rules.lootMode === "PRIORITY" ? ButtonStyle.Primary : ButtonStyle.Secondary));
  if (rules.lootMode === "RESERVE") buttons.push(btn("reserves", `Reserves per player: ${rules.reservesPerPlayer}`));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
      new ActionRowBuilder<ButtonBuilder>().addComponents(btn("back", "◀ Players"), btn("finish", "Finish ✔", ButtonStyle.Success))
    ]
  };
}

function nameModal() {
  return new ModalBuilder().setCustomId("corewiz:name-modal").setTitle("New raid core").addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Name").setPlaceholder("Tuesday Molten Core").setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(50).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("description").setLabel("Description (optional)").setPlaceholder("Progression, achievement runs").setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("schedule").setLabel("Horaire auto : 7 jours (optionnel)").setPlaceholder("mardi 20h; jeudi 20h30 — heure du serveur").setStyle(TextInputStyle.Paragraph).setMaxLength(400).setRequired(false))
  );
}

// `draft` prefills the form (priceDraft): current prices, then items still missing one with a
// suggestion from past awards ("= ?" lines are skipped on save).
export function pricesModal(core: Pick<RaidCore, "name">, draft = "") {
  const field = new TextInputBuilder().setCustomId("prices").setLabel("One 'item = GP' per line; '= ?' is skipped")
    .setPlaceholder("Sulfuras, Hand of Ragnaros = 250\nBindings of the Windseeker = 120").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000);
  if (draft) field.setValue(draft.slice(0, 4000));
  return new ModalBuilder().setCustomId("corewiz:prices-modal").setTitle(`Item prices: ${core.name}`.slice(0, 45)).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(field));
}

export function epModal(core: RaidCore) {
  // Discord limits: a label and the title are at most 45 characters, and an empty value is not allowed.
  const input = (id: string, label: string, value: number | null) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder("empty = guild default")
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(5);
    if (value !== null) field.setValue(String(value));
    return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
  };
  return new ModalBuilder().setCustomId("corewiz:ep-modal").setTitle(`EP values: ${core.name}`.slice(0, 45)).addComponents(
    input("attendance", "EP for attending", core.attendanceEp), input("late", "EP for arriving late", core.lateEp),
    input("boss", "EP per boss killed", core.bossEp), input("clear", "Bonus EP for a full clear", core.completionEp));
}

// "" keeps the guild default (null); anything else must be a whole number 0 or more.
export function parseEpField(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,5}$/.test(trimmed)) throw new Error(`"${trimmed}" is not a whole number of EP.`);
  return Number(trimmed);
}

export async function runCoreWizard(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = (await guildService.ensureGuild(interaction.guildId ?? "", interaction.guild?.name ?? "")).id;
  await interaction.reply({ ...nameStep(), ephemeral: true });
  const message: Message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: 20 * 60_000, filter: (i) => i.user.id === interaction.user.id });
  let coreId: string | null = null;
  let mode: EditMode = { role: "DPS", bench: false };

  const show = async (payload: Awaited<ReturnType<typeof rosterStep>> | ReturnType<typeof nameStep>) => { await interaction.editReply(payload); };

  collector.on("collect", async (i: MessageComponentInteraction) => {
    const action = i.customId.replace("corewiz:", "");
    try {
      if (action === "cancel") {
        await i.update({ content: "Cancelled. Nothing was created.", embeds: [], components: [] });
        collector.stop("closed");
        return;
      }
      if (action === "name" && i.isButton()) {
        await i.showModal(nameModal());
        const submitted = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.user.id === i.user.id }).catch(() => null);
        if (!submitted) return;
        try {
          const schedule = submitted.fields.getTextInputValue("schedule");
          parseWeeklySchedule(schedule);
          await submitted.deferUpdate();
          const settings = await guildService.getSettings(guildId);
          const core = await coreService.create(
            guildId, submitted.fields.getTextInputValue("name"),
            submitted.fields.getTextInputValue("description") || null,
            schedule || null,
            { timezone: settings?.timezone ?? "America/Toronto", createdBy: i.user.id }
          );
          coreId = core.id;
          // Its own category, channels and role (5.0: made with the core).
          const discord = await ensureCoreDiscord(interaction.guild, prisma, guildId, core.id);
          await fillCoreWeeklyRaids(prisma, guildId, core.id);
          const { runDiscordJobs } = await import("../services/discord-jobs.js");
          await runDiscordJobs(interaction.client);
          const note = (discord.error ? `Created **${core.name}**. Its channels could not be made: ${discord.error}` : `Created **${core.name}** and its channels.`)
            + (core.weeklySchedule ? `\n📅 ${core.schedule} (${core.weeklyTimezone}). Les raids des 7 prochains jours sont préparés; la suite s'ajoute automatiquement. Ajuste l'horaire dans /core edit.` : "");
          await show(await rosterStep(core, guildId, note, mode));
        } catch (error) {
          const content = error instanceof Error ? error.message : "Could not create the core.";
          if (submitted.deferred) await submitted.followUp({ content, ephemeral: true });
          else await submitted.reply({ content, ephemeral: true });
        }
        return;
      }
      if (!coreId) return;
      const core = await prisma.raidCore.findUniqueOrThrow({ where: { id: coreId } });
      if (action === "mode" && i.isStringSelectMenu()) {
        await i.deferUpdate();
        mode = parseMode(i.values[0] ?? "DPS");
        await show(await rosterStep(core, guildId, "", mode));
        return;
      }
      if (action === "add" && i.isUserSelectMenu()) {
        await i.deferUpdate();
        const added: string[] = [];
        for (const userId of i.values) {
          const person = await interaction.guild?.members.fetch(userId).catch(() => null);
          if (!person || person.user.bot) continue;
          const member = await guildService.ensureMember(guildId, userId, person.displayName);
          await coreService.addMember(guildId, coreId, member.id, mode.role, mode.bench);
          added.push(person.displayName);
        }
        await syncCoreRoster(interaction.guild, prisma, guildId, coreId);
        await show(await rosterStep(core, guildId, added.length ? `Added ${added.join(", ")} as ${ROLE_LABEL[mode.role]}${mode.bench ? " (bench)" : ""}.` : "Nobody added (bots are skipped).", mode));
        return;
      }
      if (action === "rules" || action === "back") {
        await i.deferUpdate();
        await interaction.editReply(action === "rules" ? await rulesStep(coreId, guildId, "") : await rosterStep(core, guildId, "", mode));
        return;
      }
      if (action === "pool") {
        if ((await guildService.getSettings(guildId))?.coreLootOnly) throw new Error("Les EP/GP restent séparés pour chaque core.");
        await i.deferUpdate();
        await prisma.raidCore.update({ where: { id: coreId }, data: { separatePool: !core.separatePool } });
        await interaction.editReply(await rulesStep(coreId, guildId, !core.separatePool ? "This core now has its own point pool (from now on)." : "Back to the shared guild pool."));
        return;
      }
      if (action === "lootmode" && i.isStringSelectMenu()) {
        await i.deferUpdate();
        const chosen = i.values[0] ?? "DEFAULT";
        const settings = await guildService.getSettings(guildId);
        if (settings?.coreLootOnly && chosen === "DEFAULT") throw new Error("Choisis la méthode de butin de ce core.");
        await prisma.raidCore.update({ where: { id: coreId }, data: { lootMode: chosen === "DEFAULT" ? null : asLootMode(chosen), ...(settings?.coreLootOnly ? { separatePool: true } : {}) } });
        await interaction.editReply(await rulesStep(coreId, guildId, chosen === "DEFAULT" ? "Loot follows the guild again." : `Loot in this core: ${LOOT_MODE_LABEL[asLootMode(chosen)]}.`));
        return;
      }
      if (action === "reserves") {
        await i.deferUpdate();
        const next = ((core.reservesPerPlayer ?? 1) % 5) + 1;
        await prisma.raidCore.update({ where: { id: coreId }, data: { reservesPerPlayer: next } });
        await interaction.editReply(await rulesStep(coreId, guildId, `Each player may reserve ${next} item${next === 1 ? "" : "s"}.`));
        return;
      }
      if (action === "prices" && i.isButton()) {
        await i.showModal(pricesModal(core, (await priceDraft(prisma, guildId, coreId)).text));
        const submitted = await i.awaitModalSubmit({ time: 10 * 60_000, filter: (m) => m.user.id === i.user.id }).catch(() => null);
        if (!submitted) return;
        try {
          const parsed = parseItemValues(submitted.fields.getTextInputValue("prices"));
          if (parsed.values.length === 0) throw new Error(parsed.problems[0] ?? "No prices found. Use one line per item: Sulfuras = 250");
          const saved = await itemValues.setMany(guildId, coreId, parsed.values);
          await submitted.deferUpdate();
          await interaction.editReply(await rulesStep(coreId, guildId, `Saved ${saved} price(s).${parsed.problems.length ? ` Skipped: ${parsed.problems.slice(0, 2).join("; ")}` : ""}`));
        } catch (error) {
          await submitted.reply({ content: error instanceof Error ? error.message : "Could not save the prices.", ephemeral: true });
        }
        return;
      }
      if (action === "ep" && i.isButton()) {
        await i.showModal(epModal(core));
        const submitted = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.user.id === i.user.id }).catch(() => null);
        if (!submitted) return;
        try {
          await prisma.raidCore.update({
            where: { id: coreId },
            data: {
              attendanceEp: parseEpField(submitted.fields.getTextInputValue("attendance")), lateEp: parseEpField(submitted.fields.getTextInputValue("late")),
              bossEp: parseEpField(submitted.fields.getTextInputValue("boss")), completionEp: parseEpField(submitted.fields.getTextInputValue("clear"))
            }
          });
          await submitted.deferUpdate();
          await interaction.editReply(await rulesStep(coreId, guildId, "EP values saved."));
        } catch (error) {
          await submitted.reply({ content: error instanceof Error ? error.message : "Could not save.", ephemeral: true });
        }
        return;
      }
      if (action === "finish") {
        await syncCoreRoster(interaction.guild, prisma, guildId, coreId);
        const settings = await guildService.getSettings(guildId);
        await i.update({
          content: `✅ **${core.name}** is ready.\n`
            + `• Create its raids with \`/raid create core:${core.name}\` (its members get signup priority).\n`
            + `• Change the roster any time (roles, bench, add, remove): \`/core edit core:${core.name}\`; rules: \`/core rules\`.\n`
            + (settings?.coreChannelId ? `• Its roster is posted in <#${settings.coreChannelId}>.` : "• Set a raid roster channel in `/setup start` step 3 to show the roster there."),
          embeds: [], components: []
        });
        collector.stop("closed");
      }
    } catch (error) {
      console.error("Core wizard step failed", error);
      const text = error instanceof Error ? error.message : String(error);
      if (!i.replied && !i.deferred) await i.reply({ content: `That didn't work: ${text}`, ephemeral: true }).catch(() => undefined);
      else await i.followUp({ content: `That didn't work: ${text}`, ephemeral: true }).catch(() => undefined);
    }
  });
  collector.on("end", async (_c, reason) => {
    if (reason !== "closed") await interaction.editReply({ content: "The core wizard timed out. What you saved is kept; use /core setup to continue or /core add.", embeds: [], components: [] }).catch(() => undefined);
  });
}
