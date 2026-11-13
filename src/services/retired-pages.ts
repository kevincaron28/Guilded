import type { WebRoute } from "./web-app.js";
import { link } from "./web-layout.js";

// The "Who's free?" page was retired (9.3.0). Its old address goes to the account page (a permanent redirect) instead of a
// 404. The posts it stored (WebAvailability) are left alone: they expire by themselves, and "Delete my data" still removes
// a member's own.
export const retiredAvailabilityRoute: WebRoute = async (ctx, kit) => {
  if (ctx.request.path !== "/me/availability" && ctx.request.path !== "/me/availability/") return null;
  return { ...kit.redirect(link("/me/", ctx.lang)), status: 301 };
};
