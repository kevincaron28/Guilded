import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: ".env.local" });
loadDotenv();

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DATABASE_URL: z.string().url(),
  COMPANION_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  // 127.0.0.1 = this computer only. On a server behind HTTPS (deploy/), use 0.0.0.0 or leave 127.0.0.1 with a reverse proxy.
  COMPANION_API_HOST: z.string().min(1).default("127.0.0.1"),
  COMPANION_UPLOAD_TOKEN: z.string().min(32).optional(),
  // Warcraft Logs API v2 client (https://www.warcraftlogs.com/api/clients). Optional: /raid wcl stays off without it.
  WCL_CLIENT_ID: z.string().min(1).optional(),
  WCL_CLIENT_SECRET: z.string().min(1).optional(),
  // Site used when /raid wcl gets a bare report code instead of a full link.
  WCL_BASE_URL: z.string().url().default("https://www.warcraftlogs.com"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Optional: a channel (any guild the bot is in) that gets a live feed of
  // captured command/job errors and /report bug submissions. Without it,
  // reports still save to the database, just without the live post.
  ERROR_LOG_CHANNEL_ID: z.string().min(1).optional()
});

export const config = environmentSchema.parse(process.env);
