// A raid core, and a raid, is played on one realm. A character from another realm is refused
// at signup instead of every signup line showing its realm.

const normalized = (realm: string) => realm.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();

export const sameRealm = (a: string, b: string) => normalized(a) === normalized(b);

// The realm a core or raid is on: the one an officer set, else the one every character already
// in it shares. Null when nothing says so yet (the first character decides).
export function requiredRealm(explicit: string | null | undefined, present: (string | null | undefined)[]): string | null {
  if (explicit?.trim()) return explicit.trim();
  const realms = present.filter((realm): realm is string => !!realm?.trim());
  const first = realms[0];
  return first && realms.every(realm => sameRealm(realm, first)) ? first : null;
}

export function assertRealm(character: { name: string; realm: string }, required: string | null, where: string): void {
  if (!required || sameRealm(character.realm, required)) return;
  throw new Error(`${character.name} est sur le royaume ${character.realm}, mais ${where} est sur ${required}. Choisis un personnage de ${required}. / ${character.name} is on ${character.realm}, but ${where} is on ${required}. Pick a character on ${required}.`);
}
