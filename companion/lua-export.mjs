import { readFile } from "node:fs/promises";
import { parseAddonExportText } from "./lua-export-content.mjs";
export { parseAddonExportText } from "./lua-export-content.mjs";
export async function readAddonExport(path, realm) {
  return parseAddonExportText(await readFile(path, "utf8"), realm);
}
