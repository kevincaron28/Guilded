import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

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

describe("installed companion startup capture", () => {
  it.each(["capture", "write"])("exits unsuccessfully when %s fails", async failure => {
    const start = main.indexOf("  if (screenshotPath) {");
    const block = main.slice(start, main.indexOf("}).catch(failStartup);", start));
    let timer: (() => Promise<void>) | undefined;
    const error = new Error("diagnostic failure");
    const exit = vi.fn();
    const quit = vi.fn();
    const log = vi.fn();
    const writeFileSync = vi.fn(() => { throw error; });
    runInNewContext("let quitting = false;\n" + block, {
      screenshotPath: "C:/test/window.png",
      win: { show: vi.fn(), webContents: {
        isLoading: () => false,
        capturePage: async () => {
          if (failure === "capture") throw error;
          return { toPNG: () => Buffer.from("png") };
        }
      } },
      fs: { writeFileSync }, app: { exit, quit }, console: { error: log },
      setTimeout: (callback: () => Promise<void>) => { timer = callback; }
    });
    await expect(timer!()).resolves.toBeUndefined();
    expect(exit).toHaveBeenCalledWith(1);
    expect(quit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Guilded Companion screenshot failed:", error);
    expect(writeFileSync).toHaveBeenCalledTimes(failure === "write" ? 1 : 0);
  });
  it.each([true, false])("finishes when the renderer isLoading=%s after startup", async loading => {
    const start = main.indexOf("  if (screenshotPath) {");
    const end = main.indexOf("}).catch(failStartup);", start);
    const block = main.slice(start, end);
    const events = new Map<string, () => void>();
    let timer: (() => Promise<void>) | undefined;
    const png = Buffer.from("rendered window");
    const writeFileSync = vi.fn();
    const quit = vi.fn();
    const show = vi.fn();
    runInNewContext("let quitting = false;\n" + block, {
      screenshotPath: "C:/test/window.png",
      win: { show, webContents: {
        isLoading: () => loading,
        once: (event: string, callback: () => void) => events.set(event, callback),
        capturePage: async () => ({ toPNG: () => png })
      } },
      fs: { writeFileSync }, app: { quit },
      setTimeout: (callback: () => Promise<void>) => { timer = callback; }
    });
    if (loading) {
      expect(timer).toBeUndefined();
      events.get("did-finish-load")!();
    } else {
      expect(events.size).toBe(0);
    }
    expect(timer).toBeTypeOf("function");
    await timer!();
    expect(writeFileSync).toHaveBeenCalledWith("C:/test/window.png", png);
    expect(quit).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
  });
});
