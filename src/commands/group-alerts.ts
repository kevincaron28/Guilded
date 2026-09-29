import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, type StringSelectMenuInteraction
} from "discord.js";
import type { GroupAlert, RaidRole } from "@prisma/client";
import { prisma } from "../database.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { GROUP_KINDS, type GroupKind } from "../services/dungeon-group.js";
import { ALL_ROLES, describeAlert } from "../services/group-alerts.js";
import { guildService } from "./context.js";

// "My group alerts" (5.0): a private panel, opened from the pinned group finder menu or with
// /dungeon alerts, where a member picks the kinds of group they want a ping for and the roles
// they play. Saved on every change. See services/group-alerts.ts for who gets pinged.

export const GROUP_ALERT_PREFIX = "galert:";
export const GROUP_ALERT_OPEN_ID = "dguide:alerts";

const ROLE_NAMES: Record<RaidRole, string> = { TANK: "Tank", HEALER: "Healer", DPS: "DPS" };
const ROLE_EMOJI: Record<RaidRole, string> = { TANK: "🛡️", HEALER: "💚", DPS: "⚔️" };

export function alertPanel(lang: Lang, alert: Pick<GroupAlert, "kinds" | "roles"> | null, levels: { name: string; level: number | null }[]) {
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const kinds = alert?.kinds ?? [];
  const roles = alert?.roles ?? [];
  const summary = describeAlert(kinds, roles, (kind) => T(GROUP_KINDS[kind].label), (role) => T(ROLE_NAMES[role]), T("Off"), T("any role"));
  const characters = levels.length
    ? levels.map((character) => `${character.name}${character.level ? ` ${character.level}` : ""}`).join(", ")
    : T("none linked yet (link one with /character pair so the levels can match; until then every group of your kinds pings you)");
  const content = [
    T("**My group alerts**: {summary}", { summary }),
    T("You are pinged in the group finder when a group of these kinds is posted, your characters' level fits it and it still needs one of your roles."),
    T("Your characters: {list}", { list: characters })
  ].join("\n");
  const kindMenu = new StringSelectMenuBuilder()
    .setCustomId(`${GROUP_ALERT_PREFIX}kinds`)
    .setPlaceholder(T("Ping me for... (none = off)"))
    .setMinValues(0)
    .setMaxValues(Object.keys(GROUP_KINDS).length)
    .addOptions((Object.keys(GROUP_KINDS) as GroupKind[]).map((kind) => ({
      label: T(GROUP_KINDS[kind].label).slice(0, 100), value: kind, emoji: GROUP_KINDS[kind].emoji, default: kinds.includes(kind)
    })));
  const roleMenu = new StringSelectMenuBuilder()
    .setCustomId(`${GROUP_ALERT_PREFIX}roles`)
    .setPlaceholder(T("I play... (none = any role)"))
    .setMinValues(0)
    .setMaxValues(ALL_ROLES.length)
    .addOptions(ALL_ROLES.map((role) => ({ label: T(ROLE_NAMES[role]), value: role, emoji: ROLE_EMOJI[role], default: roles.includes(role) })));
  const off = new ButtonBuilder().setCustomId(`${GROUP_ALERT_PREFIX}off`).setLabel(T("Turn my alerts off")).setStyle(ButtonStyle.Secondary).setDisabled(kinds.length === 0);
  return {
    content,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(kindMenu),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(roleMenu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(off)
    ]
  };
}

async function context(interaction: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction) {
  if (!interaction.guild) throw new Error("Use this in the server.");
  const record = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const member = await guildService.ensureMember(record.id, interaction.user.id,
    (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  const lang = asLang((await guildService.getSettings(record.id))?.language);
  const alert = await prisma.groupAlert.findUnique({ where: { memberId: member.id } });
  const characters = await prisma.character.findMany({ where: { memberId: member.id }, select: { name: true, level: true }, orderBy: { isMain: "desc" } });
  return { guildId: record.id, memberId: member.id, lang, alert, characters };
}

// The pinned menu's "My group alerts" button, and /dungeon alerts.
export async function openGroupAlerts(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const { lang, alert, characters } = await context(interaction);
  await interaction.reply({ ...alertPanel(lang, alert, characters), ephemeral: true });
}

// A change in the panel: saved, then the panel is redrawn.
export async function handleGroupAlertComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const { guildId, memberId, lang, alert, characters } = await context(interaction);
  const action = interaction.customId.slice(GROUP_ALERT_PREFIX.length);
  let kinds = alert?.kinds ?? [];
  let roles = alert?.roles ?? [];
  if (action === "kinds" && interaction.isStringSelectMenu()) kinds = interaction.values.filter((value) => value in GROUP_KINDS);
  else if (action === "roles" && interaction.isStringSelectMenu()) roles = interaction.values.filter((value) => (ALL_ROLES as string[]).includes(value));
  else if (action === "off") kinds = [];
  else return;
  const saved = kinds.length === 0 && roles.length === 0
    ? await prisma.groupAlert.deleteMany({ where: { memberId } }).then(() => null)
    : await prisma.groupAlert.upsert({ where: { memberId }, create: { guildId, memberId, kinds, roles }, update: { kinds, roles } });
  await interaction.update(alertPanel(lang, saved, characters));
}
