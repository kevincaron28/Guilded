import { createHmac, timingSafeEqual } from "node:crypto";

// The seal of a dungeon run record (docs/plans/SINGLE_WITNESS_ADDON_SEAL.md). The addon writes `integrity.seal` next to the
// observation provenance the run already carries (dungeon-integrity.ts): { install, seq, mac }. The mac is an HMAC-SHA256
// over the canonical text of the run's main fields, keyed with a random per-install secret; seq counts the install's runs.
//
// What it is: a speed bump. It exposes a saved file edited by hand without knowing the scheme, an old record played back
// (the same sequence number twice, or a lower one than the last seen), and one install file copied to two PCs. What it is not:
// protection against a modified addon or anyone who reads the source, because the secret sits in the same SavedVariables file.
// So a bad seal is an anomaly flag for officers, never a refusal, and a missing seal (older addon) is normal.

export interface Seal { install: string; seq: number; mac: string }
export type SealState = "valid" | "invalid" | "absent";

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose | null => value && typeof value === "object" && !Array.isArray(value) ? value as Loose : null;
const whole = (value: unknown): string => typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : "";
const text = (value: unknown): string => typeof value === "string" ? value : "";

/** The seal written on a run, or null when there is none or it is malformed. */
export function sealOf(raw: unknown): Seal | null {
  const seal = record(record(record(raw)?.["integrity"])?.["seal"]);
  if (!seal || typeof seal["install"] !== "string" || typeof seal["mac"] !== "string" || typeof seal["seq"] !== "number") return null;
  if (!/^[0-9a-f]{8,64}$/.test(seal["install"]) || !/^[0-9a-f]{64}$/.test(seal["mac"]) || !Number.isInteger(seal["seq"]) || seal["seq"] < 1) return null;
  return { install: seal["install"], seq: seal["seq"], mac: seal["mac"] };
}

/**
 * The text the mac covers: one field per line, fixed order, lists sorted, numbers as whole numbers, no JSON (so the addon's Lua
 * and this code agree byte for byte). The spec lists the same order.
 */
export function canonicalText(raw: unknown, install: string, seq: number): string {
  const run = record(raw) ?? {};
  const players = (Array.isArray(run["players"]) ? run["players"] : []).flatMap((entry) => {
    const player = record(entry);
    return player && typeof player["character"] === "string" ? [`${player["character"]}:${whole(player["level"])}:${whole(player["deaths"])}:${whole(player["presentSec"])}`] : [];
  }).sort();
  const kills = (Array.isArray(run["encounters"]) ? run["encounters"] : []).flatMap((entry) => {
    const boss = record(entry);
    return boss && boss["success"] === true && typeof boss["id"] === "number" ? [`${whole(boss["id"])}@${whole(boss["at"])}`] : [];
  });
  return ["guilded-run-seal-1", install, String(seq), text(run["id"]), whole(run["instanceId"]), whole(run["difficultyId"]), whole(run["startedAt"]),
    whole(run["endedAt"]), text(run["state"]), text(run["completedBy"]), players.join(","), kills.join(",")].join("\n");
}

/** The mac the addon writes (also used by tests and by the server when a secret is registered). */
export function sealMac(secret: string, raw: unknown, install: string, seq: number): string {
  return createHmac("sha256", secret).update(canonicalText(raw, install, seq)).digest("hex");
}

/** valid: the mac matches. invalid: a seal is there and does not match (edited after sealing, or the wrong secret). absent: no seal. */
export function verifySeal(raw: unknown, secret: string): SealState {
  const seal = sealOf(raw);
  if (!seal) return record(record(raw)?.["integrity"])?.["seal"] === undefined ? "absent" : "invalid";
  const expected = Buffer.from(sealMac(secret, raw, seal.install, seal.seq), "hex");
  const given = Buffer.from(seal.mac, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given) ? "valid" : "invalid";
}

/**
 * A copied install file: this run's sequence number is already used by a different run of the same install. `seen` maps the run
 * references the server holds for the install to their sequence numbers. The same run sent again is not a replay.
 */
export function sealReplay(seal: Seal, runRef: string, seen: ReadonlyMap<string, number>): boolean {
  if (seen.get(runRef) === seal.seq) return false; // the same run sent again
  for (const [ref, seq] of seen) if (ref !== runRef && seq === seal.seq) return true; // one number, two runs: a copied install file
  return false;
}
