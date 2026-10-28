import { readSavedText } from "./saved-file.mjs";
import { parseAddonExportText } from "./lua-export-content.mjs";
export { parseAddonExportText } from "./lua-export-content.mjs";
export async function readAddonExport(path, realm) {
  return parseAddonExportText(await readSavedText(path), realm);
}
