import { describe, expect, it } from "vitest";
import { autoStep, linkWizard } from "../companion/link-wizard.mjs";

// Owner, 7 November 2026: "sync and setup should be automatic; remove options in the setup and install
// automatically". The wizard sets up WoW and the addon by itself and opens the Discord sign-in by
// itself, once each per run, and asks only when it could not finish.
const missingAddon = { savedFile: { addon: { status: "not-installed", expected: "forever", folder: "D:/WoW/_forever_/Interface/AddOns/Guilded" } }, problems: [{ id: "addon-missing" }] };

describe("what the wizard does by itself", () => {
  it("sets up WoW and the addon once, then opens the Discord sign-in once", () => {
    const wow = linkWizard(missingAddon);
    expect(autoStep(wow)).toBe("setup-wow");
    expect(autoStep(wow, { wow: true })).toBeNull();
    const discord = linkWizard({ savedFile: { addon: { status: "ok" } } });
    expect(discord.current).toBe("discord");
    expect(autoStep(discord)).toBe("sign-in");
    expect(autoStep(discord, { signIn: true })).toBeNull();
  });

  it("never acts while the page is not on screen or a sign-in is already waiting", () => {
    expect(autoStep(linkWizard(missingAddon), { visible: false })).toBeNull();
    expect(autoStep(linkWizard({ savedFile: { addon: { status: "ok" } } }), { signInBusy: true })).toBeNull();
    expect(autoStep(null)).toBeNull();
  });

  it("leaves the server and characters steps to the member's browser and WoW", () => {
    const server = linkWizard({ config: { companionCredential: "c", personal: true }, savedFile: { addon: { status: "ok" } } });
    expect(server.current).toBe("server");
    expect(autoStep(server)).toBeNull();
  });
});

describe("what the member sees on step 1", () => {
  it("no options while it works; Try again (and Choose WoW folder only when the folder is the problem) after", () => {
    expect(linkWizard(missingAddon).setupHelp).toEqual({ text: "Setting up WoW and the Guilded addon: looking on every drive…", button: null, chooseFolder: false });
    expect(linkWizard({ ...missingAddon, autoTried: true }).setupHelp).toEqual({ text: "The companion could not install the Guilded addon by itself. Exit World of Warcraft, then press Try again.", button: "Try again", chooseFolder: false });
    const noFolder = linkWizard({ config: { wowEnabled: true }, savedFile: null, autoTried: true });
    expect(noFolder.current).toBe("wow");
    expect(noFolder.setupHelp).toMatchObject({ button: "Try again", chooseFolder: true });
  });

});
