import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCombatLog } from "../scripts/validate-combat-log.mjs";

describe("combat-log guard", () => {
  it("rejects any combat-log event in addon code (WoW Forever restricts it)", () => {
    const source = readFileSync("addon/Guilded/Modules/Dungeon.lua", "utf8").replaceAll("\r\n", "\n");
    expect(() => validateCombatLog(source)).not.toThrow();
    expect(() => validateCombatLog(`${source}\ncompat.registerEvent(frame, "COMBAT_LOG_EVENT_UNFILTERED", true)`)).toThrow();
  });
});
