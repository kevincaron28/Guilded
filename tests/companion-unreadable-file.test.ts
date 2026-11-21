import { describe, expect, it } from "vitest";
import { companionProblems, reportableProblems } from "../companion/problems.mjs";
import { mainStatus } from "../companion/main-status.mjs";

// 21 Nov 2026: an officer's companion logged "SavedVariables contains too many Lua values" on every upload for an hour and
// showed nothing; the problem is now on screen and in the report.
describe("saved file that cannot be read", () => {
  const tooMany = "SavedVariables contains too many Lua values. Keep your original file and ask an officer for help.";

  it("is a problem when the upload or the standings update cannot read the file", () => {
    for (const state of [{ uploadError: tooMany }, { standingsError: tooMany }]) {
      expect(companionProblems({ state }).find((problem: { id: string }) => problem.id === "saved-file-unreadable")).toEqual({ id: "saved-file-unreadable", data: { tooBig: true } });
    }
    const broken = companionProblems({ state: { uploadError: "GuildedDB was not found in the SavedVariables file." } });
    expect(broken.find((problem: { id: string }) => problem.id === "saved-file-unreadable")).toEqual({ id: "saved-file-unreadable", data: { tooBig: false } });
  });

  it("is not raised by other failures", () => {
    const ids = companionProblems({ state: { uploadError: "Could not reach the bot", standingsError: "Upload failed (400): bad" } }).map((problem: { id: string }) => problem.id);
    expect(ids).not.toContain("saved-file-unreadable");
  });

  it("asks the member to act and reports only the allowlisted flag", () => {
    const problems = companionProblems({ state: { uploadError: tooMany } });
    expect(mainStatus({ state: { uploadError: tooMany }, problems }).needsYou).toMatchObject({ id: "saved-file-unreadable", tone: "bad" });
    expect(reportableProblems([{ id: "saved-file-unreadable", data: { tooBig: true, path: "C:\secret" } }])).toEqual([{ id: "saved-file-unreadable", tooBig: true }]);
  });
});
