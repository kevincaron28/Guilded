import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// Officer tools on the raid signup post and on a core's roster post. Discord cannot hide a button
// from some viewers, so each post carries one small "Officer" entry button; the controls themselves
// live in an ephemeral menu that only opens for a current Officer (re-checked on every click).
export const OFFICER_PREFIX = "offt:";

export type OfficerKind = "raid" | "core";
export type OfficerAction =
  | "menu" | "edit" | "cancel" | "cancel-ok" | "cancel-ping" | "reopen" | "lock" | "unlock"
  | "archive" | "archive-ok" | "unarchive" | "appchan";

export const officerId = (kind: OfficerKind, entityId: string, action: OfficerAction) => `${OFFICER_PREFIX}${kind}:${entityId}:${action}`;
export const officerModalId = (kind: OfficerKind, entityId: string) => `${OFFICER_PREFIX}m:${kind}:${entityId}`;

export function parseOfficerId(customId: string): { kind: OfficerKind; entityId: string; action: OfficerAction } | null {
  const [prefix, kind, entityId, action] = customId.split(":");
  if (`${prefix}:` !== OFFICER_PREFIX || (kind !== "raid" && kind !== "core") || !entityId || !action) return null;
  return { kind, entityId, action: action as OfficerAction };
}

export function parseOfficerModalId(customId: string): { kind: OfficerKind; entityId: string } | null {
  const [prefix, marker, kind, entityId] = customId.split(":");
  if (`${prefix}:` !== OFFICER_PREFIX || marker !== "m" || (kind !== "raid" && kind !== "core") || !entityId) return null;
  return { kind, entityId };
}

// The one visible button: the controls open only for officers.
export function officerEntryButton(kind: OfficerKind, entityId: string, lang: "en" | "fr") {
  return new ButtonBuilder().setCustomId(officerId(kind, entityId, "menu")).setEmoji("🛡️")
    .setLabel(lang === "fr" ? "Officier" : "Officer").setStyle(ButtonStyle.Secondary);
}

export const officerEntryRow = (kind: OfficerKind, entityId: string, lang: "en" | "fr") =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(officerEntryButton(kind, entityId, lang));
