import { describe, expect, it } from "vitest";
import { backupFileName, backupsToDelete } from "../src/services/backup.js";

describe("backups", () => {
  it("names files by UTC day", () => {
    expect(backupFileName(new Date("2026-09-25T23:30:00Z"))).toBe("quebec-gold-2026-09-25.json.gz");
  });

  it("deletes only the oldest of our own files beyond the limit", () => {
    const files = ["notes.txt", "quebec-gold-2026-09-03.json.gz", "quebec-gold-2026-09-01.json.gz", "quebec-gold-2026-09-02.json.gz"];
    expect(backupsToDelete(files, 2)).toEqual(["quebec-gold-2026-09-01.json.gz"]);
    expect(backupsToDelete(files, 14)).toEqual([]);
  });
});
