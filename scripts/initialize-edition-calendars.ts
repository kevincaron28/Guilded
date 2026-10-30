import { prisma } from "../src/database.js";
import { editionCalendarInventory, initializationPreview, initializeEmptyEditionCalendars } from "../src/services/initialize-edition-calendars.js";
const expected = process.argv.find(arg => arg.startsWith("--expected="))?.slice(11);
try {
  if (process.argv.includes("--apply")) {
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Apply requires a reviewed --expected=<preview sha256>");
    console.log(JSON.stringify(await initializeEmptyEditionCalendars(prisma, expected), null, 2));
  } else console.log(JSON.stringify({ applied: false, ...initializationPreview(await editionCalendarInventory(prisma)) }, null, 2));
} finally { await prisma.$disconnect(); }
