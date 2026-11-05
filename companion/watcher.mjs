import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createEngine, pairAccount, validateConfig } from "./engine.mjs";
import { checkSavedFile } from "./live-folder.mjs";
import { checkInstalledAddon } from "./addon-install.mjs";

// Command-line companion (start-companion.bat). The desktop app in
// companion-app/ does the same job with a window and a tray icon.
const configPath = resolve("companion/companion.config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.pairingCode !== undefined && typeof config.pairingCode !== "string") {
  throw new Error("companion.config.json: pairingCode must be text.");
}
if (config.pairingCode?.trim()) {
  const result = await pairAccount(config);
  if (!result.ok) throw new Error(result.message);
  config.companionCredential = result.companionCredential;
  config.personal = result.personal === true;
  config.pairingCode = "";
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(result.message);
}
const problems = validateConfig(config);
if (problems.length > 0) throw new Error(`companion.config.json: ${problems[0]}`);
// Launch day: the live game may save this file in another game folder than the beta did.
const { candidate } = config.wowEnabled === false ? {} : await checkSavedFile(config.watchFile);
if (candidate) console.warn(`Your saved data may have moved to ${candidate.path}. Set watchFile in companion.config.json to it to keep uploading.`);

const addon = config.wowEnabled === false ? { status: "unchecked" } : await checkInstalledAddon(config.watchFile);
if (addon.status === "wrong-edition") console.warn(`The Guilded addon in ${addon.folder} is the ${addon.installed.join(", ")} build, but this game folder needs ${addon.expected}. WoW will not load it. Reinstall the ${addon.expected} build.`);

const engine = createEngine(config, {
  onLog: ({ level, message }) => (level === "error" ? console.error : console.log)(message)
});
await engine.start();
