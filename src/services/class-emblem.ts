// Painted class and role emblems (64 px WebP, transparent) shown at 20 px beside a name. Decorative: the class name or role stays in the text.
const CLASSES = new Set(["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"]);
const ROLES: Record<string, string> = { TANK: "tank", HEALER: "healer", DPS: "damage", MELEE: "damage", RANGED: "damage" };

export const EMBLEM_CSS = ".emb{width:20px;height:20px;vertical-align:-4px;margin-right:6px;flex:none}";

const img = (file: string): string => `<img class="emb" src="/images/web/${file}-64.webp" alt="" width="20" height="20" loading="lazy">`;

/** The class emblem for an English class name such as "Mage", or "" when the class is unknown. */
export const classEmblem = (className: string | null | undefined): string => {
  const slug = (className ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return CLASSES.has(slug) ? img(`class-${slug}`) : "";
};

/** The role emblem for TANK, HEALER, DPS, MELEE or RANGED, or "" for anything else. */
export const roleEmblem = (role: string | null | undefined): string => {
  const key = ROLES[(role ?? "").toUpperCase()];
  return key ? img(`role-${key}`) : "";
};
