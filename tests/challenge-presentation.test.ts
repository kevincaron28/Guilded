import { describe, expect, it } from "vitest";
import { challengePolicyText } from "../src/services/challenge-rating.js";

describe("keystone rating explanation", () => {
  it("distinguishes the on-time bonus from overtime credit in both languages", () => {
    expect(challengePolicyText("guilded-keystone-v2", "en")).toContain("in-time keys can earn a speed bonus");
    expect(challengePolicyText("guilded-keystone-v2", "en")).toContain("Eligible overtime keys");
    expect(challengePolicyText("guilded-keystone-v2", "fr")).toContain("clés à temps peuvent recevoir un bonus de vitesse");
    expect(challengePolicyText("guilded-keystone-v1", "en")).toContain("only in-time keys count");
  });
});
