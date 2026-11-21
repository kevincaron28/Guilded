import { describe, expect, it } from "vitest";
import { renderTemplate, DEFAULT_WELCOME_TEMPLATE, DEFAULT_FAREWELL_TEMPLATE } from "../src/services/housekeeping.js";

describe("renderTemplate", () => {
  it("substitutes all known variables", () => {
    const result = renderTemplate("{mention} joined {guild} ({membercount} members): {username}", {
      mention: "<@123>",
      username: "kevin",
      guildName: "Guilded",
      memberCount: 42
    });
    expect(result).toBe("<@123> joined Guilded (42 members): kevin");
  });

  it("leaves unknown placeholders untouched", () => {
    const result = renderTemplate("Hello {unknown}!", {
      mention: "<@123>",
      username: "kevin",
      guildName: "Guilded",
      memberCount: 1
    });
    expect(result).toBe("Hello {unknown}!");
  });

  it("renders the default welcome and farewell templates without throwing", () => {
    const vars = { mention: "<@1>", username: "kevin", guildName: "Guilded", memberCount: 5 };
    expect(renderTemplate(DEFAULT_WELCOME_TEMPLATE, vars)).toContain("Guilded");
    expect(renderTemplate(DEFAULT_FAREWELL_TEMPLATE, vars)).toContain("kevin");
  });
});
