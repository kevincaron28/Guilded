// 8.5 track C4: the short profession tag the opt-in "write professions to public notes" officer tool uses
// (Modules/RosterTools.lua applies it in game, one reviewed batch at a time). Guild notes hold 31 bytes, other addons
// often use them, and officer notes belong to EPGP, so the tool only ever writes PUBLIC notes that are empty or
// already carry a tag like this one. This module is the shared definition (and the test oracle) of that format.

export const NOTE_MAX = 31;
const ABBREVIATIONS: Record<string, string> = {
  alchemy: "Alch", blacksmithing: "Smith", enchanting: "Ench", engineering: "Engi", herbalism: "Herb", leatherworking: "Leath",
  mining: "Mine", skinning: "Skin", tailoring: "Tail", cooking: "Cook", "first aid": "Aid", fishing: "Fish"
};

/** "Alch300 Herb300": highest skill first, as many professions as fit in 31 characters; "" when there are none. */
export function professionNoteTag(skills: readonly { name: string; skill: number | null }[]): string {
  const parts: string[] = [];
  const sorted = [...skills].filter((s) => s.skill !== null && s.skill > 0).sort((a, b) => b.skill! - a.skill! || a.name.localeCompare(b.name));
  for (const s of sorted) {
    const key = s.name.trim().toLowerCase();
    const tag = `${ABBREVIATIONS[key] ?? s.name.trim().replace(/[^A-Za-z]/g, "").slice(0, 4)}${Math.min(999, s.skill!)}`;
    if ([...parts, tag].join(" ").length > NOTE_MAX) break;
    parts.push(tag);
  }
  return parts.join(" ");
}

/** True when a public note may be overwritten by the tool: empty, or nothing but profession tags from the list above. */
export function noteIsWritable(note: string | null | undefined): boolean {
  const text = (note ?? "").trim();
  const tag = `(?:${Object.values(ABBREVIATIONS).join("|")})\\d{1,3}`;
  return text === "" || new RegExp(`^${tag}(?: ${tag})*$`).test(text);
}
