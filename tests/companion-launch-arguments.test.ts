import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const main = readFileSync("companion-app/main.cjs", "utf8");
const startup = main.slice(0, main.indexOf("if (!app.requestSingleInstanceLock())"));
function launch(argv: string[], defaultApp?: boolean, isPackaged = true) {
  return runInNewContext(startup + "\n({ args, startHidden, screenshotPath, screenshotTab })", {
    require: (id: string) => id === "electron" ? { app: { isPackaged } } : {},
    process: { argv, defaultApp }
  }) as { args: string[]; startHidden: boolean; screenshotPath: string; screenshotTab: string };
}

describe("companion launch arguments", () => {
  it("honors the first --hidden option supplied by Windows autostart", () => {
    expect(launch(["C:/Program Files/Guilded Companion.exe", "--hidden"]).startHidden).toBe(true);
  });
  it("keeps a normal installed launch visible", () => {
    expect(launch(["C:/Program Files/Guilded Companion.exe"]).startHidden).toBe(false);
  });
  it("accepts screenshot output as the first installed-app option", () => {
    expect(launch(["Guilded Companion.exe", "--screenshot=C:/test folder/window.png", "--tab=wow"]))
      .toMatchObject({ screenshotPath: "C:/test folder/window.png", screenshotTab: "wow" });
  });
  it.each([false, true])("skips the app path under the default Electron launcher, isPackaged=%s", isPackaged => {
    const result = launch(["electron.exe", "C:/app", "--hidden", "--fresh"], true, isPackaged);
    expect(result.args).toEqual(["--hidden", "--fresh"]);
    expect(result.startHidden).toBe(true);
  });
});
