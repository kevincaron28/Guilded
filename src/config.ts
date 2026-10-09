import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: ".env.local" });
loadDotenv();

// An empty line in .env ("AI_API_KEY=") means not set.
function blankAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema);
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  HOSTED_PILOT: z.enum(["true", "false", "1", "0"]).default("false").transform(value => value === "true" || value === "1"),
  HOSTED_GUILD_IDS: z.string().default(""),
  HOSTED_GUILD_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  DATABASE_URL: z.string().url(),
  COMPANION_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  // 127.0.0.1 = this computer only. On a server behind HTTPS (deploy/), use 0.0.0.0 or leave 127.0.0.1 with a reverse proxy.
  COMPANION_API_HOST: z.string().min(1).default("127.0.0.1"),
  // Warcraft Logs API v2 client (https://www.warcraftlogs.com/api/clients). Optional: /raid wcl stays off without it.
  WCL_CLIENT_ID: blankAsUndefined(z.string().min(1).optional()),
  WCL_CLIENT_SECRET: blankAsUndefined(z.string().min(1).optional()),
  // Site used when /raid wcl gets a bare report code instead of a full link.
  WCL_BASE_URL: z.string().url().default("https://www.warcraftlogs.com"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Optional: a channel (any guild the bot is in) that gets a live feed of
  // captured command/job errors and /report bug submissions. Without it,
  // reports still save to the database, just without the live post.
  ERROR_LOG_CHANNEL_ID: blankAsUndefined(z.string().min(1).optional()),
  // 5.0 answer channel. Reading what members write needs Discord's privileged "Message Content
  // Intent": turn it on for the bot in the Developer Portal FIRST, then set this to true (asking
  // for it without the portal switch makes Discord refuse the login).
  MESSAGE_CONTENT_INTENT: z.preprocess((value) => value === "true" || value === "1", z.boolean()).default(false),
  // Optional AI answers when no officer answer matches: any OpenAI-compatible chat endpoint.
  // Free options: a Google AI Studio key (https://generativelanguage.googleapis.com/v1beta/openai),
  // a Groq key (https://api.groq.com/openai/v1), or Ollama on the server (http://127.0.0.1:11434/v1, no key).
  AI_BASE_URL: blankAsUndefined(z.string().url().optional()),
  AI_MODEL: blankAsUndefined(z.string().min(1).optional()),
  AI_API_KEY: blankAsUndefined(z.string().min(1).optional()),
  // Provider attempts per guild per UTC day; the host-wide cap applies as well.
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).max(10_000).default(100),
  AI_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(0).max(10_000).default(100)
});

export const config = environmentSchema.parse(process.env);
