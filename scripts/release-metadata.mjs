import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Candidate packaging must never silently reuse an older release's notes.
export function releaseMetadata(root = ".") {
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const metadata = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
  assert.equal(metadata.version, version, "Release metadata version mismatch");
  assert.ok(["candidate", "release"].includes(metadata.channel), "Unknown release channel");
  for (const key of ["notes", "acceptance"]) assert.match(metadata[key], /^docs\/[A-Z0-9_]+\.md$/, "Invalid release document path");
  const notes = readFileSync(join(root, metadata.notes), "utf8");
  assert.ok(notes.startsWith(`# Guilded ${version} `), "Release notes do not match the package version");
  assert.ok(readFileSync(join(root, metadata.acceptance), "utf8").length > 0, "Missing acceptance checklist");
  return { ...metadata, notesText: notes };
}
