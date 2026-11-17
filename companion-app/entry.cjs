// The app's entry point. `--self-test` loads every module of this built app, prints one JSON line and exits
// (companion-app/selftest.cjs), before main.cjs runs anything: no window, tray, single-instance lock, update,
// autostart or network. Any other launch is the normal app.
if (process.argv.includes("--self-test")) require("./selftest.cjs").run(require("electron").app);
else require("./main.cjs");
