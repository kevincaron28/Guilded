import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { errorText } from "./errors";
import { t } from "./i18n";

describe("errorText", () => {
  it("answers an unreachable server in the member's language", () => {
    const offline = new ApiError("Guilded could not be reached. Check the connection and the server address.", 0);
    expect(errorText(offline, "fr", "x")).toBe(t("fr", "errOffline"));
    expect(errorText(offline, "en", "x")).toBe(t("en", "errOffline"));
    expect(errorText(offline, "fr", "x")).not.toMatch(/Guilded could not/);
  });
  it("replaces a server failure but keeps a 4xx explanation as the server wrote it", () => {
    expect(errorText(new ApiError("The server answered 503.", 503), "fr", "x")).toBe(t("fr", "errServer"));
    expect(errorText(new ApiError("That item is not on the wishlist.", 400), "fr", "x")).toBe("That item is not on the wishlist.");
    expect(errorText(new ApiError("Too many requests. Try again shortly.", 429), "fr", "x")).toBe(t("fr", "errBusy"));
    expect(errorText(new ApiError("Too many requests. Try again shortly.", 429), "en", "x")).toBe("Too many requests. Try again shortly.");
  });
  it("never shows an engine message", () => {
    expect(errorText(new TypeError("Network request failed"), "en", "Try again")).toBe("Try again");
    expect(errorText("boom", "fr", "Réessayer")).toBe("Réessayer");
  });
});
