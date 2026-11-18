import { z } from "zod";
import { windowLimiter } from "./companion-device.js";

// POST /api/v1/mobile/report (phone app 0.4.0): a person on the friendly error screen taps "Send error report" and the
// app files one bug report, like /report bug (consented, redacted, one reference back). Nothing is sent automatically.
// No sign-in is needed (the app can fail before one), so it is small and rate-limited per network.

export const MOBILE_REPORTS_PER_NETWORK_PER_HOUR = 5;
export const allowMobileReport = windowLimiter(MOBILE_REPORTS_PER_NETWORK_PER_HOUR, 3_600_000);

const clean = (max: number) => z.string().trim().max(max).transform((value) => Array.from(value).filter((char) => char === "\n" || (char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)).join(""));
export const mobileReportSchema = z.object({
  message: clean(400).refine((value) => value.length > 0),
  stack: clean(1200).optional().default(""),
  version: clean(20).optional().default("unknown"),
  platform: z.enum(["android", "ios", "web"]).optional().default("android"),
  screen: clean(40).optional().default("")
}).strict();

/** The text filed as the bug report (the bot redacts it again before saving). Null when the body is not a report. */
export function mobileReportText(body: unknown): string | null {
  const parsed = mobileReportSchema.safeParse(body);
  if (!parsed.success) return null;
  const { message, stack, version, platform, screen } = parsed.data;
  return [`Phone app ${version} (${platform})${screen ? ` · ${screen}` : ""}`, message, ...(stack ? ["", stack] : [])].join("\n");
}
