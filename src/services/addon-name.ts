import { currentEdition } from "./edition-context.js";
import { characterReference } from "../../companion/character-identity.mjs";

export function addonName(name: string, realm?: string, edition = currentEdition()): string {
  if (edition === "forever") return name;
  const ref = characterReference(name, realm ?? "", edition);
  if (!ref.realm) throw new Error("A Blizzard character needs a realm before exporting to the addon.");
  return `${ref.character}-${ref.realm}`;
}
