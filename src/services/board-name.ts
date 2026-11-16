// A member's Discord nickname can read "Maxle (Druid) (Maxle Dru…": the nickname sync adds the class and the
// character names in brackets. Cutting that at a fixed width left a doubled, half-open label on the community
// boards, so the cut now never ends inside an open bracket and falls back to the plain start of the name.
export function boardName(raw: string, max: number): string {
  const flat = raw.replace(/[\r\n]/g, " ").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max);
  const open = cut.lastIndexOf("("), close = cut.lastIndexOf(")");
  if (open > close) cut = cut.slice(0, open);
  cut = cut.trimEnd();
  return cut || flat.slice(0, max).trimEnd();
}
