// The developer's bug inbox. Reads the database in .env.local; never starts a Discord client.
//   npm run bugs                         writes bug-inbox.md (open /bug reports and bot errors)
//   npm run bugs -- --days 60            looks further back (default 30 days)
//   npm run bugs -- resolve REF [REF...] --note "what changed"
import { writeFile } from "node:fs/promises";
import { disconnectDatabase, prisma } from "../src/database.js";
import { loadInbox, renderInbox, resolveReports } from "../src/services/bug-inbox.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const [, value] = args.splice(index, 2);
  return value ?? null;
};
try {
  const note = option("--note");
  const days = Number(option("--days") ?? 30);
  if (args[0] === "resolve") {
    const refs = args.slice(1);
    if (!refs.length) throw new Error("Use: npm run bugs -- resolve REF [REF...] --note \"what changed\"");
    console.log(`Marked ${await resolveReports(prisma, refs, note)} report(s) fixed.`);
  } else {
    if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error("--days must be between 1 and 365.");
    const inbox = await loadInbox(prisma, { days });
    await writeFile("bug-inbox.md", renderInbox(inbox), { mode: 0o600 });
    if (inbox.truncated?.bugs || inbox.truncated?.errors) console.warn("INCOMPLETE INBOX: older open reports are omitted. See warnings in bug-inbox.md.");
    console.log(`bug-inbox.md: ${inbox.bugs.length} bug report(s), ${inbox.errors.length} kind(s) of bot error since ${inbox.since.toISOString().slice(0, 10)}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The bug inbox could not be read.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
