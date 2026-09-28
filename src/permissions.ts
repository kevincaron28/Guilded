import type { GuildMember } from "discord.js";

export const permissionRoles = {
  guildMaster: "Guild Master",
  officer: "Officer",
  raidLeader: "Raid Leader",
  dkpOfficer: "DKP Officer",
  lootLeader: "Loot Leader",
  classLeader: "Class Leader"
} as const;

export type Permission = keyof typeof permissionRoles;

// A French guild (setup language) gets French role names. Both spellings work everywhere, so a
// server can be switched or mixed without anyone losing access.
export const permissionRolesFr = {
  guildMaster: "Maître de guilde",
  officer: "Officier",
  raidLeader: "Chef de raid",
  dkpOfficer: "Officier DKP",
  lootLeader: "Chef du butin",
  classLeader: "Chef de classe"
} as const;

export const permissionRoleNames = (permission: Permission): string[] => [permissionRoles[permission], permissionRolesFr[permission]];
export const roleNamesFor = (lang: "en" | "fr") => (lang === "fr" ? permissionRolesFr : permissionRoles);

// One Class Leader role per class ("Class Leader (Warrior)", "Chef de classe (Guerrier)"),
// created from /setup. Each counts as Class Leader everywhere the bot checks.
export const CLASS_NAMES_FR: Record<string, string> = {
  Warrior: "Guerrier", Paladin: "Paladin", Hunter: "Chasseur", Rogue: "Voleur", Priest: "Prêtre", Shaman: "Chaman",
  Mage: "Mage", Warlock: "Démoniste", Druid: "Druide", "Death Knight": "Chevalier de la mort", Monk: "Moine",
  "Demon Hunter": "Chasseur de démons", Evoker: "Évocateur"
};
export function classLeaderRoleName(className: string, lang: "en" | "fr"): string {
  return lang === "fr"
    ? `${permissionRolesFr.classLeader} (${CLASS_NAMES_FR[className] ?? className})`
    : `${permissionRoles.classLeader} (${className})`;
}
const isClassLeaderVariant = (name: string): boolean =>
  [permissionRoles.classLeader, permissionRolesFr.classLeader].some((base) => name.startsWith(`${base} (`) && name.endsWith(")"));

// True when a Discord role name is one of the names for the permission (either language).
export const isPermissionRoleName = (permission: Permission, name: string): boolean =>
  permissionRoleNames(permission).includes(name) || (permission === "classLeader" && isClassLeaderVariant(name));

const inheritedPermissions: Record<Permission, readonly Permission[]> = {
  guildMaster: ["guildMaster"],
  officer: ["officer", "guildMaster"],
  raidLeader: ["raidLeader", "officer", "guildMaster"],
  dkpOfficer: ["dkpOfficer", "officer", "guildMaster"],
  lootLeader: ["lootLeader", "officer", "guildMaster"],
  classLeader: ["classLeader", "officer", "guildMaster"]
};

export function hasPermission(member: GuildMember, permission: Permission): boolean {
  if (member.permissions.has("Administrator")) return true;
  return inheritedPermissions[permission].some((role) =>
    member.roles.cache.some((guildRole) => isPermissionRoleName(role, guildRole.name))
  );
}
