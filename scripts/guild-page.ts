// Owner-only editing of a guild's public page (docs/GUILD_PAGES_DESIGN.md). Talks to the
// database only; never starts a Discord client or prints credentials.
import { disconnectDatabase, prisma } from "../src/database.js";
import { editGuildPage } from "../src/services/guild-page.js";

const [action = "status", serverId, ...rest] = process.argv.slice(2);
try {
  console.log(await editGuildPage(prisma, action, serverId, rest.join(" ")));
} catch (error) {
  console.error(error instanceof Error ? error.message : "The guild page could not be updated.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
