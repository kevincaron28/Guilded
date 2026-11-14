import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Only publish verified public signing identities supplied by the release owner. */
export function writeMobileAssociations(out, env = process.env) {
  const fingerprints = (env.MOBILE_ANDROID_SHA256_FINGERPRINTS || "").split(",").map(value => value.trim()).filter(Boolean);
  const team = env.MOBILE_APPLE_TEAM_ID || "";
  if (fingerprints.some(value => !/^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(value))) {
    throw new Error("MOBILE_ANDROID_SHA256_FINGERPRINTS must contain comma-separated signing certificate SHA-256 fingerprints.");
  }
  if (team && !/^[A-Z0-9]{10}$/.test(team)) throw new Error("MOBILE_APPLE_TEAM_ID must be the verified Apple team identifier.");
  const directory = join(out, ".well-known");
  // A repeat build without identities must not retain an older association.
  if (!fingerprints.length) rmSync(join(directory, "assetlinks.json"), { force: true });
  if (!team) rmSync(join(directory, "apple-app-site-association"), { force: true });
  if (!fingerprints.length && !team) return { android: false, ios: false };
  mkdirSync(directory, { recursive: true });
  if (fingerprints.length) writeFileSync(join(directory, "assetlinks.json"), JSON.stringify([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: "top.kcaron.guilded", sha256_cert_fingerprints: fingerprints.map(value => value.toUpperCase()) },
  }], null, 2) + "\n");
  if (team) writeFileSync(join(directory, "apple-app-site-association"), JSON.stringify({
    applinks: { apps: [], details: [{ appID: `${team}.top.kcaron.guilded`, paths: ["/app/*"] }] },
  }, null, 2) + "\n");
  return { android: fingerprints.length > 0, ios: Boolean(team) };
}
