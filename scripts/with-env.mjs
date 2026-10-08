import { config as loadDotenv } from "dotenv";
import { spawnSync } from "node:child_process";
import { prismaEnv } from "./direct-url.mjs";

// The app itself loads .env.local then .env (see src/config.ts), but CLI
// tools like the Prisma CLI only auto-load .env. This wrapper gives npm
// scripts the same environment the bot runs with.
loadDotenv({ path: ".env.local" });
loadDotenv();

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-env.mjs <command> [...args]");
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: prismaEnv(command, args, process.env),
  shell: process.platform === "win32"
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
