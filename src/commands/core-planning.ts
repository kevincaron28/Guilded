import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction } from "discord.js";
import { prisma } from "../database.js";
import { CORE_RAID_SIZES, coreComposition, planningOptions } from "../services/core-planning.js";
import { parseWeeklySchedule, weeklyOccurrences, weeklyScheduleText } from "../services/core-weekly-time.js";
import { fillCoreWeeklyRaids, saveCoreWeeklySchedule } from "../services/core-weekly-raids.js";

const field = (id: string, label: string, value: string, placeholder: string, required = true) => {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setRequired(required).setStyle(TextInputStyle.Short);
  if (value) input.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
};
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export async function editCoreComposition(i: ButtonInteraction, guildId: string, coreId: string): Promise<string | null> {
  await i.deferReply({ ephemeral: true });
  const core = await prisma.raidCore.findFirstOrThrow({ where: { id: coreId, guildId } });
  const pickerId = `size:${i.id}`;
  await i.editReply({ content: "Taille du raid / Raid size", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(pickerId).setPlaceholder("10 / 20 / 40 joueurs").setMinValues(1).setMaxValues(1)
      .addOptions(CORE_RAID_SIZES.map(size => ({ label: `${size} joueurs / players`, value: String(size), default: core.raidSize === size })))
  )] });
  const message = await i.fetchReply();
  const choice = await message.awaitMessageComponent({ time: 300_000, filter: c => c.user.id === i.user.id && c.customId === pickerId }).catch(() => null);
  if (!choice?.isStringSelectMenu()) { await i.editReply({ content: "Taille inchangée (expiré).", components: [] }); return null; }
  const size = choice.values[0]!;
  const keepRoles = core.raidSize === Number(size);
  const id = `composition:${i.id}`;
  await choice.showModal(new ModalBuilder().setCustomId(id).setTitle(`${size} joueurs — Rôles / Roles`).addComponents(
    field("tanks", "Tanks", keepRoles ? core.tankLimit?.toString() ?? "" : "", "Nombre de tanks"),
    field("healers", "Soigneurs / Healers", keepRoles ? core.healerLimit?.toString() ?? "" : "", "Nombre de soigneurs"),
    field("dps", "DPS", keepRoles ? core.dpsLimit?.toString() ?? "" : "", "Nombre de DPS")
  ));
  const submitted = await choice.awaitModalSubmit({ time: 300_000, filter: m => m.user.id === i.user.id && m.customId === id }).catch(() => null);
  await i.editReply({ components: [] });
  if (!submitted) return null;
  try {
    const data = coreComposition(size, ...["tanks", "healers", "dps"].map(key => submitted.fields.getTextInputValue(key)) as [string, string, string]);
    await submitted.deferReply({ ephemeral: true });
    await prisma.raidCore.update({ where: { id: core.id }, data });
    const note = `${data.raidSize} joueurs : ${data.tankLimit} tanks / ${data.healerLimit} soigneurs / ${data.dpsLimit} DPS. Appliqué aux nouveaux raids; les raids publiés restent inchangés.`;
    await submitted.editReply(note);
    return note;
  } catch (error) {
    const content = error instanceof Error ? error.message : "Impossible d'enregistrer.";
    if (submitted.deferred) await submitted.editReply(content); else await submitted.reply({ content, ephemeral: true });
    return null;
  }
}

export async function editCoreSchedule(i: ButtonInteraction, guildId: string, coreId: string): Promise<string | null> {
  const core = await prisma.raidCore.findFirstOrThrow({ where: { id: coreId, guildId } });
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { timezone: true } });
  const timezone = settings?.timezone ?? "America/Toronto";
  const slots = parseWeeklySchedule(core.weeklySchedule ?? "");
  const pickerId = `days:${i.id}`;
  await i.reply({ content: `📅 **${core.name}** — choisis les jours de raid (${timezone}).`, ephemeral: true,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(pickerId)
      .setPlaceholder("Jours de raid / Raid days").setMinValues(1).setMaxValues(7)
      .addOptions(DAYS.map((label, day) => ({ label, value: String(day), default: slots.some(slot => slot.weekday === day) })))
      .addOptions({ label: "Arrêter la création automatique / Stop", value: "stop" }))] });
  const message = await i.fetchReply();
  const choice = await message.awaitMessageComponent({ time: 300_000, filter: c => c.user.id === i.user.id && c.customId === pickerId }).catch(() => null);
  if (!choice?.isStringSelectMenu()) { await i.editReply({ content: "Horaire inchangé (expiré).", components: [] }); return null; }
  if (choice.values.includes("stop")) {
    await choice.deferUpdate();
    if (choice.values.length !== 1) { await i.editReply({ content: "Choisis Arrêter seul, ou seulement les jours. Horaire inchangé.", components: [] }); return null; }
    await saveCoreWeeklySchedule(prisma, guildId, coreId, "", i.user.id);
    await i.editReply({ content: "Création automatique arrêtée. Les raids publiés sont conservés.", components: [] });
    return "Création automatique arrêtée.";
  }
  const id = `times:${i.id}`;
  const first = slots[0];
  const clock = first ? `${String(first.hour).padStart(2, "0")}:${String(first.minute).padStart(2, "0")}` : "20:00";
  const differentTimes = slots.some(slot => slot.hour !== first?.hour || slot.minute !== first?.minute);
  await choice.showModal(new ModalBuilder().setCustomId(id).setTitle(`Heures — ${timezone}`.slice(0, 45)).addComponents(
    field("time", "Heure commune / Start time", clock, "20:00"),
    field("start", "Première date / Start date (YYYY-MM-DD)", core.weeklyStartDate ?? "", "2026-12-01 (exemple); vide = maintenant", false),
    field("days", "Jours à préparer / Days ahead (1–90)", String(core.weeklyHorizonDays ?? 6), "28"),
    field("custom", "Heures différentes (optionnel / optional)", differentTimes ? core.weeklySchedule ?? "" : "", "mardi 20h; jeudi 21h (remplace les jours)", false)
  ));
  const submitted = await choice.awaitModalSubmit({ time: 300_000, filter: m => m.user.id === i.user.id && m.customId === id }).catch(() => null);
  await i.editReply({ components: [] });
  if (!submitted) return null;
  try {
    const input = submitted.fields.getTextInputValue("custom").trim() || `${choice.values.map(value => DAYS[Number(value)]).join("/")} ${submitted.fields.getTextInputValue("time")}`;
    const start = submitted.fields.getTextInputValue("start"), days = submitted.fields.getTextInputValue("days");
    const planning = planningOptions(start, days);
    const parsed = parseWeeklySchedule(input);
    if (!parsed.length) throw new Error("Choisis au moins un départ de raid.");
    const occurrences = weeklyOccurrences(parsed, timezone, new Date(), planning);
    const confirmId = `confirm:${i.id}`;
    await submitted.reply({ content: `**${weeklyScheduleText(parsed)}** (${timezone})\nDébut : ${planning.weeklyStartDate ?? "maintenant"} · fenêtre : ${planning.weeklyHorizonDays} jours.\n${occurrences.length} dates à préparer dès maintenant (les dates existantes sont réutilisées).\n${occurrences.slice(0, 6).map(row => `<t:${Math.floor(row.scheduledAt.getTime() / 1000)}:F>`).join("\n")}\nLes raids déjà publiés restent inchangés.`, ephemeral: true,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel("Enregistrer et préparer les raids").setStyle(ButtonStyle.Success))] });
    const preview = await submitted.fetchReply();
    const confirm = await preview.awaitMessageComponent({ time: 300_000, filter: c => c.user.id === i.user.id && c.customId === confirmId }).catch(() => null);
    if (!confirm) { await submitted.editReply({ content: "Horaire inchangé (confirmation expirée).", components: [] }); return null; }
    await confirm.deferUpdate();
    await saveCoreWeeklySchedule(prisma, guildId, coreId, input, i.user.id, { start, days });
    const created = await fillCoreWeeklyRaids(prisma, guildId, coreId);
    const note = `📅 ${weeklyScheduleText(parsed)} · ${timezone} · début ${planning.weeklyStartDate ?? "maintenant"} · ${created.length} nouveaux raids préparés. Publication automatique en cours.`;
    await submitted.editReply({ content: note, components: [] });
    return note;
  } catch (error) {
    const content = error instanceof Error ? error.message : "Impossible d'enregistrer l'horaire.";
    if (submitted.replied || submitted.deferred) await submitted.editReply({ content, components: [] }); else await submitted.reply({ content, ephemeral: true });
    return null;
  }
}
