// Read-only. Uses the normal env wrapper; reports IDs/counts, never credentials.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  let duplicates = 0;
  for (const name of ["epgpTransaction", "dkpTransaction"]) {
    const groups = await db[name].groupBy({ by: ["guildId", "sourceRef"], where: { sourceRef: { not: null } }, _count: { _all: true } });
    const found = groups.filter((g) => g._count._all > 1);
    duplicates += found.length;
    for (const group of found) console.log(JSON.stringify({ table: name, ...group }));
  }
  console.log(duplicates ? `${duplicates} duplicate event reference(s): stop and review the accounting; no data was changed.` : "Ledger event references are unique.");
  if (duplicates) process.exitCode = 1;
} finally { await db.$disconnect(); }
