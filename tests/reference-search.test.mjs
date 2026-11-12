import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("quick reference filters", () => {
  it("keeps a search box and role chips in the page, with the full table still in the HTML", () => {
    const page = readFileSync("site/pages/reference.md", "utf8");
    expect(page).toContain('data-ref-tools');
    expect(page).toContain('data-ref-search');
    for (const role of ["Everyone", "Officer", "Raid Leader", "Admin"]) expect(page).toContain(`data-role="${role}"`);
    expect(page).toContain("| `/help` |");
    const script = readFileSync("site/site.js", "utf8");
    expect(script).toContain("applyRefFilter");
    expect(script).toContain("row.hidden");
    expect(readFileSync("site/style.css", "utf8")).toContain("@media print");
  });
});
