// Offline preflight: never connects to Discord/database or starts the bot.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";

let failed = false;
function check(ok: boolean, label: string, fix: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` — ${fix}`}`);
  if (!ok) failed = true;
}

check(Number(process.versions.node.split(".")[0]) >= 24, "Node.js 24 or newer", "Install Node.js 24 (release baseline).");
try {
  const { config } = await import("../src/config.js");
  check(!/^(placeholder|your[_ -]|replace|changeme)/i.test(config.DISCORD_TOKEN), "Bot token supplied", "Enter your own application's token locally in .env.local.");
  for (const key of ["DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"] as const) {
    check(/^\d{17,20}$/.test(config[key]), key, "Copy the numeric application/server ID from Discord.");
  }
  const database = new URL(config.DATABASE_URL);
  check(["postgres:", "postgresql:"].includes(database.protocol) && database.pathname.length > 1,
    "PostgreSQL connection string", "Use your provider's PostgreSQL URL with a database name.");
  check(config.COMPANION_API_HOST === "127.0.0.1" && config.COMPANION_API_PORT === 8787,
    "Included Caddy proxy matches API settings", "Use 127.0.0.1:8787, or adapt your proxy and review the settings manually.");
  if (config.MESSAGE_CONTENT_INTENT) console.log("NOTE Message Content Intent must also be enabled in the Discord Developer Portal.");
} catch (error) {
  // Never print the supplied config, connection string, token or raw error.
  const fields = error instanceof ZodError ? [...new Set(error.issues.map((issue) => issue.path.join(".")))].join(", ") : "configuration";
  check(false, "Configuration loads", `Check ${fields} in .env.local. Leave optional integrations blank.`);
}
check(existsSync(fileURLToPath(new URL("../companion-app/renderer/web-bundle.js", import.meta.url))),
  "Online companion built", "Run npm run companion:build.");
console.log("Offline check only: token validity, database access, Discord permissions, DNS and HTTPS still need live verification.");
console.log(failed ? "Fix the FAIL items and run npm run setup:check again. See docs/GUILD_OWNER_SETUP.md." : "Configuration checks passed. Continue with service startup and the checkpoints in docs/GUILD_OWNER_SETUP.md.");
process.exitCode = failed ? 1 : 0;
