// Explicit channel maintenance through REST, without starting a second bot.
import { REST } from "discord.js";
import { config } from "../src/config.js";
import { prisma } from "../src/database.js";
import { updateCommunityLeaderboard } from "../src/services/community-leaderboard.js";

try {
  const categoryId = process.argv[2];
  if (!categoryId || !/^\d+$/.test(categoryId)) throw new Error("Provide the existing community category ID");
  const result = await updateCommunityLeaderboard(new REST({ version: "10", timeout: 15_000, retries: 1 }).setToken(config.DISCORD_TOKEN), prisma, config.DISCORD_GUILD_ID, config.DISCORD_CLIENT_ID, { categoryId });
  console.log(JSON.stringify(result));
} catch {
  console.error("Leaderboard update could not finish. Inspect the channel before retrying; no season or point data was changed.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
