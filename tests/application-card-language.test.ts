import { describe, expect, it } from "vitest";
import { ApplicationStatus } from "../src/generated/prisma/client.js";
import { applicationEmbed } from "../src/commands/application.js";

const app = { id: "a1", character: "Thrall", className: "Shaman", spec: "Restoration", experience: "MC", availability: "Mardi", notes: "Hi", role: "HEALER" as const, core: null };

describe("raid application card language", () => {
  it("keeps English labels by default", () => {
    const names = applicationEmbed(app, "1").toJSON().fields?.map((f) => f.name);
    expect(names).toContain("Availability");
    expect(names).toContain("Experience");
  });

  it("uses French labels on French servers", () => {
    const json = applicationEmbed(app, "1", undefined, "fr").toJSON();
    const names = json.fields?.map((f) => f.name) ?? [];
    expect(names).toEqual(["Classe / Spécialisation", "Rôle", "Groupe de raid", "Expérience", "Disponibilités", "Notes"]);
    expect(json.fields?.[2]?.value).toBe("Général");
    expect(json.title).toContain("Candidature");
    expect(json.footer?.text).toContain("Id de candidature");
  });

  it("translates the decision line", () => {
    const json = applicationEmbed(app, "1", { status: ApplicationStatus.APPROVED, by: "2" }, "fr").toJSON();
    expect(json.fields?.at(-1)?.value).toBe("✅ Approuvée par <@2>");
  });
});
