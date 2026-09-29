// One-click companion setup: `npm run companion:setup`.
//
// Finds the game data and preserves an existing pairing. Never creates server secrets.
import { copyFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ENV_FILE = ".env.local";
const CONFIG_FILE = join("companion", "companion.config.json");
const args = process.argv.slice(2);
const autoYes = args.includes("--yes");
const wowArg = args.includes("--wow") ? args[args.indexOf("--wow") + 1] : null;

const rl = createInterface({ input: stdin, output: stdout });

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function dirs(path) {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function choose(question, options) {
  if (options.length === 1 || autoYes) {
    console.log(`${question} ${options[0]}`);
    return options[0];
  }
  console.log(question);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
  for (;;) {
    const answer = (await rl.question(`Type a number (1-${options.length}) and press Enter: `)).trim();
    const picked = options[Number(answer) - 1];
    if (picked) return picked;
    console.log("That isn't one of the numbers above, try again.");
  }
}

async function ask(question, fallback) {
  if (autoYes) return fallback;
  const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
  return answer || fallback;
}

// Game folders that contain WTF\Account: the install root, or a flavor
// folder inside it (_retail_, _classic_, _forever_, ...).
async function findGameFolders() {
  const roots = wowArg ? [wowArg] : [];
  for (const drive of ["C", "D", "E", "F"]) {
    for (const base of ["Program Files (x86)", "Program Files", "Games", "Blizzard", ""]) {
      roots.push(join(`${drive}:\\`, base, "World of Warcraft"));
    }
  }
  const found = [];
  for (const root of roots) {
    if (!(await exists(root))) continue;
    if (await exists(join(root, "WTF", "Account"))) found.push(root);
    for (const flavor of await dirs(root)) {
      if (flavor.startsWith("_") && await exists(join(root, flavor, "WTF", "Account"))) found.push(join(root, flavor));
    }
  }
  return [...new Set(found)];
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

async function main() {
  console.log("\n=== Guilded companion setup ===\n");

  const games = await findGameFolders();
  if (games.length === 0) {
    console.log("I couldn't find World of Warcraft. Run this again with the folder, for example:");
    console.log('  npm run companion:setup -- --wow "D:\\Games\\World of Warcraft"');
    process.exitCode = 1;
    return;
  }
  const game = await choose("WoW folder:", games);

  const accountsDir = join(game, "WTF", "Account");
  const accounts = (await dirs(accountsDir)).filter((name) => name !== "SavedVariables");
  if (accounts.length === 0) {
    console.log(`No WoW account folders in ${accountsDir}. Log in to the game once, then run this again.`);
    process.exitCode = 1;
    return;
  }
  const account = await choose("WoW account (the one you raid on):", accounts);

  // Realm folders sit next to SavedVariables inside the account folder.
  const realms = (await dirs(join(accountsDir, account))).filter((name) => name !== "SavedVariables");
  const realm = realms.length
    ? await choose("Realm (must match your characters' realm in /character add):", realms)
    : await ask("Realm name", "WoW Forever");

  const watchFile = join(accountsDir, account, "SavedVariables", "Guilded.lua");
  if (!(await exists(watchFile))) {
    console.log("\nNote: Guilded.lua doesn't exist yet. That's fine; it appears after you log in with the addon and /reload once.");
  }

  const envText = (await exists(ENV_FILE)) ? await readFile(ENV_FILE, "utf8") : "";
  const env = parseEnv(envText);
  const guildId = env.DISCORD_GUILD_ID;
  if (!guildId) {
    console.log(`\n${ENV_FILE} has no DISCORD_GUILD_ID. Set up the bot first (README "Setup"), then run this again.`);
    process.exitCode = 1;
    return;
  }
  const port = env.COMPANION_API_PORT || "8787";
  const previous = (await exists(CONFIG_FILE)) ? JSON.parse(await readFile(CONFIG_FILE, "utf8")) : {};
  if (await exists(CONFIG_FILE)) await copyFile(CONFIG_FILE, `${CONFIG_FILE}.bak`);
  const config = {
    ...previous,
    watchFile,
    realm,
    uploadUrl: previous.uploadUrl || `http://127.0.0.1:${port}/api/v1/addon-imports`,
    guildDiscordId: guildId,
    companionCredential: previous.guildDiscordId === guildId ? previous.companionCredential || "" : "",
    pairingCode: ""
  };
  await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Wrote ${CONFIG_FILE}.`);

  console.log("\nAll set. Next:");
  console.log("Open Companion Settings and link with /character pair if not already paired. Then Save and start.");
  console.log("");
}

try {
  await main();
} finally {
  rl.close();
}
