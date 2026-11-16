import { describe, expect, it, vi } from "vitest";
import { characterLinkPrompt } from "../src/services/character-link-prompt.js";

// /character pair and the welcome buttons are the member asking to link: what they unlinked themselves must not stay held back
// from the companion and /guilded verify (BLOCKED goes), while an officer's removal (REMOVED) is never touched.
function fakes() {
  return {
    character: { findMany: vi.fn(async () => []) },
    characterVerifyCode: { upsert: vi.fn(async () => ({ code: "ABCDEFGH" })) },
    characterVerifyClaim: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    guild: { findUnique: vi.fn(async () => ({ officerSyncAt: null })) },
    member: { findUnique: vi.fn(async () => null) }
  };
}

describe("characterLinkPrompt and the member's own unlinks", () => {
  it("clears only the member's own BLOCKED marks when they ask to link", async () => {
    const database = fakes();
    await characterLinkPrompt(database as never, "g1", "m1", "dg1", "en", "companion", { relinkOwn: true });
    expect(database.characterVerifyClaim.deleteMany).toHaveBeenCalledWith({ where: { guildId: "g1", memberId: "m1", status: "BLOCKED" } });
  });

  it("leaves the marks alone for an automatic prompt (a member joining)", async () => {
    const database = fakes();
    await characterLinkPrompt(database as never, "g1", "m1", "dg1", "en");
    expect(database.characterVerifyClaim.deleteMany).not.toHaveBeenCalled();
  });
});
