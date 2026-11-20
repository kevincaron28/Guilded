// Read-only usage counts for the website's account pages, last 30 and 90 days. Counts only: no member names, no Discord IDs,
// nothing is written. Page views are not stored anywhere in the database (use the Cloudflare analytics for those); these counts
// show how many people signed in and how much each removed feature's data changed.
// Run on the server (it has the production database settings): npm run web:usage
import { createPrismaClient } from "../src/database.js";

const database = createPrismaClient();
const day = 86_400_000;
const since = (days: number) => new Date(Date.now() - days * day);
const rows: Record<string, string | number>[] = [];
const add = async (what: string, count: (from: Date) => Promise<number>) => {
  try { rows.push({ what, "last 30 days": await count(since(30)), "last 90 days": await count(since(90)) }); }
  catch (error) { rows.push({ what, "last 30 days": "n/a", "last 90 days": `n/a (${(error as Error).message.slice(0, 40)})` }); }
};

try {
  const total = await database.webAccount.count();
  console.log(`Website accounts in total: ${total}`);
  await add("accounts created", (from) => database.webAccount.count({ where: { createdAt: { gte: from } } }));
  await add("accounts seen (lastSeenAt)", (from) => database.webAccount.count({ where: { lastSeenAt: { gte: from } } }));
  await add("sign-ins (sessions created)", (from) => database.webSession.count({ where: { createdAt: { gte: from } } }));
  await add("accounts that signed in", async (from) => (await database.webSession.groupBy({ by: ["accountId"], where: { createdAt: { gte: from } } })).length);
  await add("companion sign-ins (credentials created)", (from) => database.webCompanionCredential.count({ where: { createdAt: { gte: from } } }));
  // Data of the removed pages. Some of it also comes from the addon or the bot, so these are upper bounds of web use.
  await add("wishlist entries added", (from) => database.wishlistEntry.count({ where: { createdAt: { gte: from } } }));
  await add("raid plan revisions approved", (from) => database.raidPlanRevision.count({ where: { approvedAt: { gte: from } } }));
  await add("craft requests made", (from) => database.craftRequest.count({ where: { createdAt: { gte: from } } }));
  // Kept pages, for comparison.
  await add("recruitment applications sent", (from) => database.recruitmentApplication.count({ where: { createdAt: { gte: from } } }));
  await add("player cards posted or edited", (from) => database.playerCard.count({ where: { updatedAt: { gte: from } } }));
  await add("recruitment reports", (from) => database.recruitmentReport.count({ where: { createdAt: { gte: from } } }));
  console.table(rows);
} finally {
  await database.$disconnect();
}
