import { describe, expect, it } from "vitest";
import { closed, declined, parseSignupAnswer, parseSignups, signable } from "./signups";

describe("raid answers", () => {
  it("reads the list by raid id and skips malformed rows", () => {
    const answers = parseSignups({ raids: [
      { raidId: "a", status: "MAYBE", role: "HEALER", late: false, closesAt: "2026-12-01T00:00:00.000Z" },
      { raidId: "b", status: "nonsense", role: "BOSS" }, { status: "SIGNED_UP" }, null, "x"
    ] });
    expect(Object.keys(answers)).toEqual(["a", "b"]);
    expect(answers.a).toMatchObject({ status: "MAYBE", role: "HEALER", closesAt: "2026-12-01T00:00:00.000Z" });
    expect(answers.b).toMatchObject({ status: null, role: null, late: false, closesAt: null });
    expect(parseSignups(undefined)).toEqual({});
  });
  it("reads one answer, and only bot-made raids can be answered", () => {
    expect(parseSignupAnswer({ ok: true, signup: { raidId: "a", status: "WAITLISTED", role: "DPS" } })?.status).toBe("WAITLISTED");
    expect(parseSignupAnswer({ ok: true })).toBeNull();
    expect(signable("c".repeat(25))).toBe(true);
    expect(signable("discord:123456")).toBe(false);
  });
  it("knows a declined raid and a passed deadline", () => {
    const answers = parseSignups({ raids: [{ raidId: "a", status: "CANCELLED", closesAt: "2026-11-01T00:00:00.000Z" }] });
    expect(declined(answers, "a")).toBe(true);
    expect(declined(answers, "z")).toBe(false);
    expect(closed(answers.a, Date.parse("2026-11-02T00:00:00.000Z"))).toBe(true);
    expect(closed(answers.a, Date.parse("2026-10-31T00:00:00.000Z"))).toBe(false);
  });
});
