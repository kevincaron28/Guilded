// The window loads renderer/ui-bundle.js and design-tokens.css, which are built
// and not stored in git. A fresh checkout otherwise opens a blank window.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const renderer = path.join(__dirname, "renderer");
if (fs.existsSync(path.join(renderer, "ui-bundle.js")) && fs.existsSync(path.join(renderer, "design-tokens.css"))) process.exit(0);

const result = spawnSync("npm", ["run", "companion:build"], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  shell: true
});
if (result.status !== 0 || !fs.existsSync(path.join(renderer, "ui-bundle.js"))) {
  console.error("The companion window could not be built. From the repository root, run: npm run companion:build");
  process.exit(result.status || 1);
}
