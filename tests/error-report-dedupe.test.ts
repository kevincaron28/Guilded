import { describe, expect, it } from "vitest";
import { allowErrorNotification, resetErrorNotifications } from "../src/services/error-report.js";

describe("error notification dedupe", () => {
  it("keeps suppressing a repeated error when the map is full", () => {
    resetErrorNotifications();
    for (let i = 0; i < 500; i++) expect(allowErrorNotification(`e${i}`, 0)).toBe(true);
    expect(allowErrorNotification("kept", 0)).toBe(true);
    expect(allowErrorNotification("kept", 1_000)).toBe(false);
    for (let i = 0; i < 50; i++) allowErrorNotification(`n${i}`, 1_000);
    expect(allowErrorNotification("kept", 1_000)).toBe(false);
    expect(allowErrorNotification("kept", 6 * 60_000)).toBe(true);
  });
});
