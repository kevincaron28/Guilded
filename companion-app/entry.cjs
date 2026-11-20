// The app's entry point. `--self-test` loads every module of this built app, prints one JSON line and exits
// (companion-app/selftest.cjs), before main.cjs runs anything: no window, tray, single-instance lock, update,
// autostart or network. Any other launch is the normal app, after the update rollback guard
// (companion-app/update-rollback.cjs): a freshly updated version that keeps failing to run puts the previous one back
// before anything else loads, so even a crash while main.cjs loads is caught.
if (process.argv.includes("--self-test")) require("./selftest.cjs").run(require("electron").app);
else if (!rolledBack()) require("./main.cjs");

function rolledBack() {
  try {
    const { app, Notification } = require("electron");
    const fs = require("node:fs");
    const { spawn } = require("node:child_process");
    const { createHash } = require("node:crypto");
    const rollback = require("./update-rollback.cjs");
    const result = rollback.guard({
      dir: app.getPath("userData"), current: app.getVersion(), packaged: app.isPackaged,
      store: process.windowsStore === true || /[\/]WindowsApps[\/]/i.test(String(process.execPath ?? "")),
      spawn, hashFile: (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      notify: (failed, back) => { try { if (Notification.isSupported()) new Notification({ title: `Update to ${failed} failed`, body: `Back on ${back}. Your settings and Discord link were kept.` }).show(); } catch { /* the window tells it too */ } },
      log: () => {}
    });
    if (result.action !== "rollback") return false;
    setTimeout(() => app.quit(), 1500);
    return true;
  } catch { return false; } // the guard never stops the app from starting
}
