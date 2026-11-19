import { describe, expect, it } from "vitest";
import { LINK_NEXT_STEP, pickOwnCharacter } from "../src/services/own-character.js";

const row = (name: string, isMain = false) => ({ id: name, name, realm: "Forever", isMain });

describe("pickOwnCharacter", () => {
  it("uses the character the member picked", () => {
    expect(pickOwnCharacter([row("Ray", true), row("Sam")], "Sam").name).toBe("Sam");
  });
  it("defaults to the only character, then to the main", () => {
    expect(pickOwnCharacter([row("Ray")], null).name).toBe("Ray");
    expect(pickOwnCharacter([row("Sam"), row("Ray", true)], undefined).name).toBe("Ray");
  });
  it("gives the next step when nothing is linked, and never points at /character claim", () => {
    expect(() => pickOwnCharacter([], null)).toThrow(LINK_NEXT_STEP);
    expect(LINK_NEXT_STEP).not.toContain("/character claim");
    expect(() => pickOwnCharacter([], "Ray")).toThrow(LINK_NEXT_STEP);
  });
  it("asks for a choice when there are several characters and no main", () => {
    expect(() => pickOwnCharacter([row("Sam"), row("Ray")], null)).toThrow(/several characters/);
  });
});
