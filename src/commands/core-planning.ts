import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { CORE_RAID_SIZES, coreComposition, planningOptions } from "../services/core-planning.js";
import { parseWeeklySchedule, weeklyOccurrences, weeklyScheduleText } from "../services/core-weekly-time.js";
import { fillCoreWeeklyRaids, saveCoreWeeklySchedule } from "../services/core-weekly-raids.js";
import { raidPresetsForEdition, presetComposition } from "../services/raid-presets.js";
import { checkCoreAccess } from "./core-access.js";
import { tx } from "../i18n.js";
import { guildLang } from "../services/guild-bank-member.js";

const field = (id: string, label: string, value: string, placeholder: string, required = true) => {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setRequired(required).setStyle(TextInputStyle.Short);
  if (value) input.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
};
// French day names are what the schedule text uses; the parser also reads English.
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function editCoreComposition(i: ButtonInteraction, guildId: string, coreId: string): Promise<string | null> {
  if (!await checkCoreAccess(i)) return null;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const core = await prisma.raidCore.findFirstOrThrow({ where: { id: coreId, guildId } });
  const lang = await guildLang(prisma, guildId);
  const pickerId = `size:${i.id}`;
  await i.editReply({ content: tx(lang, "Size or preset. The suggested roles can be edited."), components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(pickerId).setPlaceholder(tx(lang, "Raid size")).setMinValues(1).setMaxValues(1)
      .addOptions(CORE_RAID_SIZES.map(size => ({ label: `${size} ${tx(lang, "players")}`, value: String(size), default: core.raidSize === size })))
      .addOptions(raidPresetsForEdition().map(p => ({ label: `${p.name} (${p.raidSize})`, value: `preset:${p.id}`, description: tx(lang, "{tanks} tanks / {healers} healers / {dps} DPS, editable", { tanks: p.tankLimit, healers: p.healerLimit, dps: p.dpsLimit }) })))
  )] });
  const message = await i.fetchReply();
  const choice = await message.awaitMessageComponent({ time: 300_000, filter: c => c.user.id === i.user.id && c.customId === pickerId }).catch(() => null);
  if (!choice?.isStringSelectMenu()) { await i.editReply({ content: tx(lang, "Size unchanged (expired)."), components: [] }); return null; }
  if (!await checkCoreAccess(choice)) return null;
  const selected = choice.values[0]!;
  const preset = selected.startsWith("preset:") ? presetComposition(selected.slice(7)) : null;
  const size = preset ? String(preset.raidSize) : selected;
  const keepRoles = core.raidSize === Number(size);
  const defaults = preset ?? (keepRoles ? core : null);
  const id = `composition:${i.id}`;
  await choice.showModal(new ModalBuilder().setCustomId(id).setTitle(tx(lang, "{size} players: roles", { size }).slice(0, 45)).addComponents(
    ...(selected === "custom" ? [field("size", tx(lang, "Size (10–30)"), String(core.raidSize ?? 20), "17")] : []),
    field("tanks", "Tanks", defaults?.tankLimit?.toString() ?? "", tx(lang, "Number of tanks")),
    field("healers", tx(lang, "Healers"), defaults?.healerLimit?.toString() ?? "", tx(lang, "Number of healers")),
    field("dps", "DPS", defaults?.dpsLimit?.toString() ?? "", tx(lang, "Number of DPS"))
  ));
  const submitted = await choice.awaitModalSubmit({ time: 300_000, filter: m => m.user.id === i.user.id && m.customId === id }).catch(() => null);
  if (!submitted) { await i.editReply({ components: [] }); return null; }
  if (!await checkCoreAccess(submitted)) return null;
  try {
    await submitted.deferReply({ flags: MessageFlags.Ephemeral });
    await i.editReply({ components: [] });
    const data = coreComposition(selected === "custom" ? submitted.fields.getTextInputValue("size") : size, ...["tanks", "healers", "dps"].map(key => submitted.fields.getTextInputValue(key)) as [string, string, string]);
    await prisma.raidCore.update({ where: { id: core.id }, data });
    const note = tx(lang, "{size} players: {tanks} tanks / {healers} healers / {dps} DPS. Applies to new raids; raids already posted stay as they are.", { size: data.raidSize, tanks: data.tankLimit, healers: data.healerLimit, dps: data.dpsLimit });
    await submitted.editReply(note);
    return note;
  } catch (error) {
    const content = error instanceof Error ? error.message : tx(lang, "Could not save.");
    if (submitted.deferred) await submitted.editReply(content); else await submitted.reply({ content, flags: MessageFlags.Ephemeral });
    return null;
  }
}

export async function editCoreSchedule(i: ButtonInteraction, guildId: string, coreId: string): Promise<string | null> {
  if (!await checkCoreAccess(i)) return null;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const core = await prisma.raidCore.findFirstOrThrow({ where: { id: coreId, guildId } });
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { timezone: true, language: true } });
  const lang = settings?.language === "fr" ? "fr" : "en";
  const timezone = settings?.timezone ?? "America/Toronto";
  const slots = parseWeeklySchedule(core.weeklySchedule ?? "");
  const pickerId = `days:${i.id}`;
  await i.editReply({ content: `📅 **${core.name}**: ${tx(lang, "choose the raid days ({timezone}).", { timezone })}`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(pickerId)
      .setPlaceholder(tx(lang, "Raid days")).setMinValues(1).setMaxValues(7)
      .addOptions((lang === "fr" ? DAYS : DAYS_EN).map((label, day) => ({ label, value: String(day), default: slots.some(slot => slot.weekday === day) })))
      .addOptions({ label: tx(lang, "Stop automatic creation"), value: "stop" }))] });
  const message = await i.fetchReply();
  const choice = await message.awaitMessageComponent({ time: 300_000, filter: c => c.user.id === i.user.id && c.customId === pickerId }).catch(() => null);
  if (!choice?.isStringSelectMenu()) { await i.editReply({ content: tx(lang, "Schedule unchanged (expired)."), components: [] }); return null; }
  if (!await checkCoreAccess(choice)) return null;
  if (choice.values.includes("stop")) {
    await choice.deferUpdate();
    if (choice.values.length !== 1) { await i.editReply({ content: tx(lang, "Choose Stop on its own, or only days. Schedule unchanged."), components: [] }); return null; }
    await saveCoreWeeklySchedule(prisma, guildId, coreId, "", i.user.id);
    await i.editReply({ content: tx(lang, "Automatic creation stopped. Posted raids are kept."), components: [] });
    return tx(lang, "Automatic creation stopped.");
  }
  const id = `times:${i.id}`;
  const first = slots[0];
  const clock = first ? `${String(first.hour).padStart(2, "0")}:${String(first.minute).padStart(2, "0")}` : "20:00";
  const differentTimes = slots.some(slot => slot.hour !== first?.hour || slot.minute !== first?.minute);
  await choice.showModal(new ModalBuilder().setCustomId(id).setTitle(tx(lang, "Times ({timezone})", { timezone }).slice(0, 45)).addComponents(
    field("time", tx(lang, "Start time"), clock, "20:00"),
    field("start", tx(lang, "Start date (YYYY-MM-DD)"), core.weeklyStartDate ?? "", tx(lang, "2026-12-01 (example); empty = now"), false),
    field("days", tx(lang, "Days ahead (1–90)"), String(core.weeklyHorizonDays ?? 6), "28"),
    field("custom", tx(lang, "Different times (optional)"), differentTimes ? core.weeklySchedule ?? "" : "", tx(lang, "tuesday 20h; thursday 21h (replaces the days)"), false)
  ));
  const submitted = await choice.awaitModalSubmit({ time: 300_000, filter: m => m.user.id === i.user.id && m.customId === id }).catch(() => null);
  if (!submitted) { await i.editReply({ components: [] }); return null; }
  if (!await checkCoreAccess(submitted)) return null;
  try {
    await submitted.deferReply({ flags: MessageFlags.Ephemeral });
    await i.editReply({ components: [] });
    const input = submitted.fields.getTextInputValue("custom").trim() || `${choice.values.map(value => DAYS[Number(value)]).join("/")} ${submitted.fields.getTextInputValue("time")}`;
    const start = submitted.fields.getTextInputValue("start"), days = submitted.fields.getTextInputValue("days");
    const planning = planningOptions(start, days);
    const parsed = parseWeeklySchedule(input);
    if (!parsed.length) throw new Error(tx(lang, "Choose at least one raid start."));
    const occurrences = weeklyOccurrences(parsed, timezone, new Date(), planning);
    const confirmId = `confirm:${i.id}`;
    await submitted.editReply({ content: [`**${weeklyScheduleText(parsed)}** (${timezone})`, tx(lang, "Start: {start} · window: {days} days.", { start: planning.weeklyStartDate ?? tx(lang, "now"), days: planning.weeklyHorizonDays }), tx(lang, "{count} dates to prepare now (existing dates are reused).", { count: occurrences.length }), ...occurrences.slice(0, 6).map(row => `<t:${Math.floor(row.scheduledAt.getTime() / 1000)}:F>`), tx(lang, "Raids already posted stay unchanged.")].join("\n"),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel(tx(lang, "Save and prepare the raids")).setStyle(ButtonStyle.Success))] });
    const preview = await submitted.fetchReply();
    const confirm = await preview.awaitMessageComponent({ time: 300_000, filter: c => c.user.id === i.user.id && c.customId === confirmId }).catch(() => null);
    if (!confirm) { await submitted.editReply({ content: tx(lang, "Schedule unchanged (confirmation expired)."), components: [] }); return null; }
    if (!await checkCoreAccess(confirm)) return null;
    await confirm.deferUpdate();
    await saveCoreWeeklySchedule(prisma, guildId, coreId, input, i.user.id, { start, days });
    const created = await fillCoreWeeklyRaids(prisma, guildId, coreId);
    // Publish the prepared raids now, as the old inline schedule editor did.
    const { runDiscordJobs } = await import("../services/discord-jobs.js");
    await runDiscordJobs(i.client);
    const note = tx(lang, "📅 {schedule} · {timezone} · start {start} · {count} new raids prepared. Posting automatically.", { schedule: weeklyScheduleText(parsed), timezone, start: planning.weeklyStartDate ?? tx(lang, "now"), count: created.length });
    await submitted.editReply({ content: note, components: [] });
    return note;
  } catch (error) {
    const content = error instanceof Error ? error.message : tx(lang, "Could not save the schedule.");
    if (submitted.replied || submitted.deferred) await submitted.editReply({ content, components: [] }); else await submitted.reply({ content, flags: MessageFlags.Ephemeral });
    return null;
  }
}
