import { beforeEach, describe, expect, it } from "vitest";
import { MIN_COMPANION, MIN_PROTOCOL, PROTOCOL_VERSION, clientVersionSummary, compatFields, noteClientVersion, resetClientVersions, versionBelow } from "../src/compat.js";
import { credentialHeaders, protocolSupported, setAddonVersion, setCompanionVersion, versionHeaders } from "../companion/request.mjs";
import { companionProblems } from "../companion/problems.mjs";

beforeEach(() => resetClientVersions());

const problemsFor = (input: { version: string; minCompanionVersion: string | null }) =>
  companionProblems({ config: { companionCredential: "connected", wowEnabled: false }, state: { running: true, botVersion: "9.3.5", minCompanionVersion: input.minCompanionVersion }, version: input.version }).map((problem) => problem.id);

describe("companion version header and support window", () => {
  it("counts clean versions per release and ignores junk", () => {
    expect(noteClientVersion("9.3.5")).toBe("9.3.5");
    noteClientVersion("9.3.5");
    noteClientVersion("9.1.3");
    expect(noteClientVersion("evil <script>")).toBeNull();
    expect(noteClientVersion(undefined)).toBeNull();
    expect(clientVersionSummary()).toBe("9.3.5 x2, 9.1.3 x1");
    expect(clientVersionSummary(true)).not.toBeNull();
    expect(clientVersionSummary()).toBeNull();
  });

  it("flags only versions below the window", () => {
    expect(versionBelow("9.0.9")).toBe(true);
    expect(versionBelow(MIN_COMPANION)).toBe(false);
    expect(versionBelow("9.3.5")).toBe(false);
    expect(versionBelow("garbage")).toBe(false);
    expect(compatFields("9.0.9")).toEqual({ minProtocol: MIN_PROTOCOL, minCompanionVersion: MIN_COMPANION, updateRequired: true });
    expect(compatFields("9.3.5")).not.toHaveProperty("updateRequired");
    expect(compatFields(null)).not.toHaveProperty("updateRequired");
  });

  it("accepts a protocol range that overlaps the companion's, and bots from before ranges", () => {
    expect(protocolSupported({ protocolVersion: PROTOCOL_VERSION })).toBe(true);
    expect(protocolSupported({ protocolVersion: 2, minProtocol: 2 })).toBe(true);
    expect(protocolSupported({ protocolVersion: 3, minProtocol: 2 })).toBe(true); // a future additive protocol 3
    expect(protocolSupported({ protocolVersion: 3, minProtocol: 3 })).toBe(false); // a deliberate break
    expect(protocolSupported({ protocolVersion: 1 })).toBe(false);
    expect(protocolSupported({})).toBe(false);
  });

  it("the companion shows companion-outdated when the bot's minimum is above it", () => {
    expect(problemsFor({ version: "9.0.9", minCompanionVersion: "9.1.0" })).toContain("companion-outdated");
    expect(problemsFor({ version: "9.1.0", minCompanionVersion: "9.1.0" })).not.toContain("companion-outdated");
    expect(problemsFor({ version: "9.0.9", minCompanionVersion: null })).not.toContain("companion-outdated");
  });

  it("the companion names itself and the addon it read on every request, and sends nothing odd", () => {
    setCompanionVersion("9.3.5"); setAddonVersion("9.3.4");
    expect(credentialHeaders({ companionCredential: "c" })).toEqual({ "x-companion-credential": "c", "x-companion-version": "9.3.5", "x-companion-addon-version": "9.3.4" });
    setCompanionVersion("not a version"); setAddonVersion(undefined as never);
    expect(versionHeaders()).toEqual({});
  });
});
