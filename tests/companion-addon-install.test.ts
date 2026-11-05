import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkInstalledAddon, tocEditions } from "../companion/addon-install.mjs";

// The TBC build of Guilded once sat in the WoW Forever folder: the client skips an addon whose
// interface it does not accept, so nothing loaded and nothing said why.
const folders: string[] = [];
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function game(flavor: string, toc: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "guilded-addon-")); folders.push(dir);
  const root = join(dir, "World of Warcraft");
  if (toc !== null) {
    const addon = join(root, flavor, "Interface", "AddOns", "Guilded");
    mkdirSync(addon, { recursive: true });
    writeFileSync(join(addon, "Guilded.toc"), toc);
  }
  return join(root, flavor, "WTF", "Account", "ACCT#2", "SavedVariables", "Guilded.lua");
}

describe("checkInstalledAddon", () => {
  it("flags the TBC build in the Forever folder", async () => {
    const watch = game("_forever_", "## Interface: 20506\n## X-Guilded-Edition: classic-tbc\n");
    expect(await checkInstalledAddon(watch)).toMatchObject({ status: "wrong-edition", expected: "forever", installed: ["classic-tbc"] });
  });

  it("accepts the Forever build and the older multi-interface build", async () => {
    expect((await checkInstalledAddon(game("_forever_", "## Interface: 16001\n## X-Guilded-Edition: forever\n"))).status).toBe("ok");
    expect((await checkInstalledAddon(game("_forever_", "## Interface: 16001, 20506\n"))).status).toBe("ok");
  });

  it("rejects an edition-less TOC that does not list the folder's interface", async () => {
    expect((await checkInstalledAddon(game("_forever_", "## Interface: 20506\n"))).status).toBe("wrong-edition");
  });

  it("reports a missing install and leaves unnamed folders alone", async () => {
    expect((await checkInstalledAddon(game("_forever_", null))).status).toBe("not-installed");
    expect((await checkInstalledAddon(game("_classic_beta_", "## Interface: 20506\n"))).status).toBe("unchecked");
    expect((await checkInstalledAddon("not a saved file")).status).toBe("unchecked");
  });
});

describe("tocEditions", () => {
  it("prefers the stated edition and maps interface numbers otherwise", () => {
    expect(tocEditions("## Interface: 16001\n## X-Guilded-Edition: forever\n")).toEqual(["forever"]);
    expect(tocEditions("## Interface: 16001, 11509, 120105\n")).toEqual(["forever", "classic-era", "retail"]);
    expect(tocEditions("")).toEqual([]);
  });
});
