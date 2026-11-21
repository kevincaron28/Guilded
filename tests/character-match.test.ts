import { describe, expect, it } from "vitest";
import { findCharacter } from "../src/services/character-match.js";

const list = [
  { name: "Bob", realm: "WoW-Forever", id: 1 },
  { name: "Amy", realm: "WoW-Forever", id: 2 },
  { name: "Amy", realm: "Other", id: 3 }
];

describe("findCharacter", () => {
  it("prefers the exact name and realm, ignoring case", () => {
    expect(findCharacter(list, "amy", "OTHER")?.id).toBe(3);
  });

  it("accepts a different realm when the name is unique (Forever has no real realms)", () => {
    expect(findCharacter(list, "Bob", "Forever")?.id).toBe(1);
  });

  it("refuses to guess when the name is ambiguous or unknown", () => {
    expect(findCharacter(list, "Amy", "Elsewhere")).toBeUndefined();
    expect(findCharacter(list, "Zed", "WoW-Forever")).toBeUndefined();
  });
});
