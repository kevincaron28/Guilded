import { describe, expect, it, vi } from "vitest";
import { createCraftService } from "../src/services/craft.js";

const open = { id: "c1", guildId: "g1", requesterId: "asker", crafterId: null, status: "OPEN", requester: {}, crafter: null };

describe("craft requests", () => {
  it("won't let you claim your own request", async () => {
    const service = createCraftService({ craftRequest: { findFirst: vi.fn().mockResolvedValue(open), updateMany: vi.fn() } } as never);
    await expect(service.claim("g1", "c1", "asker")).rejects.toThrow("your own request");
  });

  it("loses a claim race cleanly", async () => {
    const service = createCraftService({
      craftRequest: { findFirst: vi.fn().mockResolvedValue(open), updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
    } as never);
    await expect(service.claim("g1", "c1", "crafter")).rejects.toThrow("just claimed");
  });

  it("only the crafter or an officer can mark it done", async () => {
    const claimed = { ...open, status: "CLAIMED", crafterId: "crafter" };
    const service = createCraftService({ craftRequest: { findFirst: vi.fn().mockResolvedValue(claimed), update: vi.fn() } } as never);
    await expect(service.complete("g1", "c1", "someone-else", false)).rejects.toThrow("Only the crafter");
    await expect(service.complete("g1", "c1", "someone-else", true)).resolves.toBeTruthy();
  });

  it("only the requester or an officer can cancel", async () => {
    const service = createCraftService({ craftRequest: { findFirst: vi.fn().mockResolvedValue(open), update: vi.fn() } } as never);
    await expect(service.cancel("g1", "c1", "crafter", false)).rejects.toThrow("Only the requester");
  });
});
