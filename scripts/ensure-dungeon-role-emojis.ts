// Reuses Blizzard's icon artwork, matching Guilded's existing class/spec emoji.
// Read-only unless --apply is supplied. REST only; never starts another bot.
import { REST, Routes, type APIEmoji } from "discord.js";
import { config } from "../src/config.js";
const icons = [
  { name: "wow_role_tank", icon: "ability_warrior_defensivestance" },
  { name: "wow_role_healer", icon: "spell_holy_heal" },
  { name: "wow_role_dps", icon: "ability_dualwield" }
];
const rest = new REST({ version: "10", timeout: 15000, retries: 1 }).setToken(config.DISCORD_TOKEN);
try {
  const route = Routes.applicationEmojis(config.DISCORD_CLIENT_ID);
  const before = await rest.get(route) as { items: APIEmoji[] };
  for (const asset of icons) {
    if (before.items.some(emoji => emoji.name === asset.name)) continue;
    const response = await fetch(`https://render.worldofwarcraft.com/us/icons/56/${asset.icon}.jpg`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Icon unavailable: ${asset.name}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 256 * 1024 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error("Invalid icon image");
    if (process.argv.includes("--apply")) {
      await rest.post(route, { body: { name: asset.name, image: `data:image/jpeg;base64,${data.toString("base64")}` } });
    }
    console.log(`${process.argv.includes("--apply") ? "Created" : "Would create"}: ${asset.name}`);
  }
  const after = await rest.get(route) as { items: APIEmoji[] };
  if (before.items.some(old => !after.items.some(current => current.id === old.id && current.name === old.name))) throw new Error("Existing emoji changed unexpectedly");
  console.log(JSON.stringify(after.items.filter(emoji => icons.some(icon => icon.name === emoji.name)).map(emoji => ({ name: emoji.name, id: emoji.id }))));
} catch {
  console.error("Role emoji setup failed; check application access and icon availability. Existing emojis were not removed.");
  process.exitCode = 1;
}
