import { describe, expect, it } from "vitest";
import { mobileRoute, notificationRoute } from "./routes";

describe("mobile destinations", () => {
  it("accepts only the app scheme and scoped verified app links", () => {
    expect(mobileRoute("guilded://wishlist")).toEqual({ section: "wishlist" });
    expect(mobileRoute("https://guilded.kcaron.top/app/raids?guild=123456")).toEqual({ section: "raids", guildDiscordId: "123456" });
    expect(mobileRoute("https://guildedwow.com/app/alerts")).toEqual({ section: "alerts" });
    expect(mobileRoute("https://evil.example/app/raids")).toBeNull();
    expect(mobileRoute("https://guilded.kcaron.top/auth/callback?code=private")).toBeNull();
    expect(mobileRoute("guilded://unknown?credential=private")).toBeNull();
  });
  it("routes notification data without following attacker supplied URLs", () => {
    expect(notificationRoute({ type: "raid", guildDiscordId: "123456", raidId: "raid-1", url: "https://evil.example" })).toEqual({ section: "raids", guildDiscordId: "123456", raidId: "raid-1" });
    expect(notificationRoute({ type: "raid", guildDiscordId: "oops" })).toBeNull();
    expect(notificationRoute({ url: "guilded://raids" })).toBeNull();
  });
});

describe("where a destination lands", () => {
  it("opens raids on the Raids part, wishlist in Me and alerts in Alerts", async () => {
    const { routeTarget } = await import("./routes");
    expect(routeTarget({ section: "raids" })).toEqual({ tab: "guild", part: "raids" });
    expect(routeTarget({ section: "wishlist" })).toEqual({ tab: "me" });
    expect(routeTarget({ section: "alerts" })).toEqual({ tab: "alerts" });
    expect(routeTarget({ section: "reserves" })).toEqual({ tab: "guild", part: "roster" });
  });
  it("sends Android Back to the home tab, and leaves the app from there", async () => {
    const { backTarget } = await import("./routes");
    expect(backTarget("news", "stats")).toBe("stats");
    expect(backTarget("stats", "stats")).toBeNull();
  });
});
