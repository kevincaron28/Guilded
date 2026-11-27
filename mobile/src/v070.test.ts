import { beforeEach, describe, expect, it, vi } from "vitest";

const backListeners: (() => boolean)[] = [];
vi.mock("react-native", () => ({
  BackHandler: { addEventListener: (_: string, fn: () => boolean) => { backListeners.push(fn); return { remove: () => {} }; } },
  Platform: { OS: "android" }, Linking: { openURL: vi.fn() }, Share: { share: vi.fn() }, Keyboard: { addListener: vi.fn(), dismiss: vi.fn() }, Dimensions: { get: () => ({ height: 800 }) }
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));

import { doubleBackToExit, handleBack, setBackFallback } from "./useBack";
import { shouldAskReview, REVIEW_MIN_AFTER_LAUNCH_MS } from "./review";
import { revealOffset } from "./useKeyboardScroll";
import { feedbackReport } from "./crashReport";
import { inlinePieces, proseBlocks } from "./ui/Prose";
import { HELP } from "./helpText";
import { PRIVACY } from "./privacyText";

describe("Android Back on the home screen (0.7.0)", () => {
  beforeEach(() => setBackFallback(null));
  it("asks for a second press within two seconds before leaving", () => {
    let clock = 1000;
    const notice = vi.fn();
    const back = doubleBackToExit(notice, 2000, () => clock);
    expect(back()).toBe(true);
    expect(notice).toHaveBeenCalledTimes(1);
    clock += 1500;
    expect(back()).toBe(false);
    clock += 5000;
    expect(back()).toBe(true);
    clock += 2500;
    expect(back()).toBe(true);
    expect(notice).toHaveBeenCalledTimes(3);
  });
  it("lets Android close the app only through the fallback, and only when no layer is open", () => {
    expect(handleBack()).toBe(false);
    setBackFallback(() => true);
    expect(handleBack()).toBe(true);
    expect(backListeners.length).toBe(1);
  });
});

describe("in-app review prompt (0.7.0)", () => {
  it("asks once, from the third session, never in the first minute", () => {
    expect(shouldAskReview({ asked: false, sessions: 3, sinceLaunchMs: REVIEW_MIN_AFTER_LAUNCH_MS })).toBe(true);
    expect(shouldAskReview({ asked: true, sessions: 9, sinceLaunchMs: 600_000 })).toBe(false);
    expect(shouldAskReview({ asked: false, sessions: 2, sinceLaunchMs: 600_000 })).toBe(false);
    expect(shouldAskReview({ asked: false, sessions: 5, sinceLaunchMs: 10_000 })).toBe(false);
  });
});

describe("keyboard never covers the field (0.7.0)", () => {
  it("scrolls a field under the keyboard just above it, and leaves a visible one alone", () => {
    // Window 800 high, keyboard 300: the visible area ends at 476 with the 24 margin.
    expect(revealOffset({ y: 600, height: 48 }, 800, 300)).toBe(172);
    expect(revealOffset({ y: 200, height: 48 }, 800, 300)).toBe(0);
    expect(revealOffset({ y: 10, height: 48 }, 800, 300)).toBe(-14);
  });
});

describe("feedback report (0.7.0)", () => {
  it("fits the report route: a 400-character message and the rest as details, links scrubbed", () => {
    const long = "a".repeat(500) + " see https://example.com/secret";
    const report = feedbackReport("idea", long, "0.7.0", "android");
    expect(report.message.startsWith("Idea (app feedback): ")).toBe(true);
    expect(report.message.length).toBeLessThanOrEqual(400);
    expect(report.stack).toContain("[link]");
    expect(report.stack).not.toContain("example.com");
    expect(report.version).toBe("0.7.0");
    expect(report.screen.startsWith("feedback")).toBe(true);
  });
});

describe("help and privacy text (0.7.0)", () => {
  it("reads the Markdown the app ships: bullets, bold, code and links", () => {
    expect(proseBlocks("One\nline\n\n- a\n  - b\n\nTwo").map((b) => [b.kind, b.depth, b.text])).toEqual([["p", 0, "One line"], ["li", 0, "a"], ["li", 1, "b"], ["p", 0, "Two"]]);
    expect(inlinePieces("Open **Me** with `/x` [here](https://a.b/c).")).toEqual([
      { text: "Open " }, { text: "Me", bold: true }, { text: " with " }, { text: "/x", code: true }, { text: " " }, { text: "here", url: "https://a.b/c" }, { text: "." }
    ]);
  });
  it("has the same help topics and questions in English and French", () => {
    expect(HELP.fr.map((t) => [t.id, t.items.length])).toEqual(HELP.en.map((t) => [t.id, t.items.length]));
    for (const topic of [...HELP.en, ...HELP.fr]) for (const item of topic.items) expect(item.a).not.toMatch(/\bp[oac]\b/);
  });
  it("ships the privacy policy in both languages with its sections", () => {
    expect(PRIVACY.en.sections.length).toBeGreaterThanOrEqual(5);
    expect(PRIVACY.fr.sections.length).toBe(PRIVACY.en.sections.length);
    expect(PRIVACY.en.sections.map((s) => s.title)).toContain("Contact");
  });
});
