// Owner-run, one time (and again only when src/services/linked-roles.ts changes the records): registers the
// Linked Roles metadata schema for the application. Never runs at bot start. REST only, never starts a bot session.
//   npx tsx scripts/register-role-connections.ts           prints the records, sends nothing
//   npx tsx scripts/register-role-connections.ts --apply   PUT /applications/{id}/role-connections/metadata
import { config } from "../src/config.js";
import { metadataProblems, metadataRecords, registerMetadata } from "../src/services/linked-roles.js";

const records = metadataRecords();
console.log(JSON.stringify(records, null, 2));
const problems = metadataProblems(records);
if (problems.length) throw new Error(problems.join("; "));
if (!process.argv.includes("--apply")) {
  console.log("Dry run. Add --apply to register these records with Discord.");
} else {
  await registerMetadata(config.DISCORD_TOKEN, config.DISCORD_CLIENT_ID);
  console.log("Registered.");
}
