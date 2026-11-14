import { afterEach, describe, expect, it, vi } from "vitest";

describe("painted role emblems on the run card", () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock("node:fs/promises"); });
  it("draws the approved painting for tank, healer and damage", async () => {
    const { roleEmblem } = await import("../src/services/card-roles.js");
    for (const role of ["tank", "healer", "dps"] as const) {
      const markup = await roleEmblem(role, "painted", 10, 20, 38, new Set());
      expect(markup).toContain("<image");
      expect(markup).toContain("data:image/png;base64,");
      expect(markup).not.toContain("medalrim");
    }
  });
  it("draws the code-made medal when a painting file is missing", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", async (original) => ({ ...(await original<typeof import("node:fs/promises")>()), readFile: async () => { throw new Error("ENOENT"); } }));
    const { roleEmblem } = await import("../src/services/card-roles.js");
    const markup = await roleEmblem("tank", "painted", 10, 20, 38, new Set());
    expect(markup).toContain("medalrim");
    expect(markup).not.toContain("<image");
  });
  it("keeps the medal and frame styles as they were", async () => {
    const { roleEmblem } = await import("../src/services/card-roles.js");
    expect(await roleEmblem("healer", "medal", 0, 0, 38, new Set())).toContain("medalrim");
  });
});
