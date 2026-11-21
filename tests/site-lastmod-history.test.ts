import { describe, expect, it, vi } from "vitest";
import { deepenShallowClone, isShallowClone } from "../scripts/git-history.mjs";

// SEO4 follow-up: Cloudflare clones shallowly, so the build must deepen history before it reads commit dates.
type Exec = (file: string, args: string[], options?: object) => string;
// Cast to the helper's parameter type: the mock answers only the (file, args, options) form the helper uses.
const fakeGit = (answers: Record<string, string | Error>) => vi.fn<Exec>((_file, args) => {
  const answer = answers[args.join(" ")];
  if (answer === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
  if (answer instanceof Error) throw answer;
  return answer;
}) as unknown as Parameters<typeof isShallowClone>[0] & ReturnType<typeof vi.fn<Exec>>;

describe("site build git history", () => {
  it("detects a shallow clone from rev-parse and treats a failed probe as not shallow", () => {
    expect(isShallowClone(fakeGit({ "rev-parse --is-shallow-repository": "true\n" }))).toBe(true);
    expect(isShallowClone(fakeGit({ "rev-parse --is-shallow-repository": "false\n" }))).toBe(false);
    expect(isShallowClone(fakeGit({ "rev-parse --is-shallow-repository": new Error("not a repo") }))).toBe(false);
  });

  it("leaves a full clone alone and fetches nothing", () => {
    const exec = fakeGit({ "rev-parse --is-shallow-repository": "false" });
    expect(deepenShallowClone(exec)).toBe("not-shallow");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("unshallows a shallow clone with a blobless filter", () => {
    const exec = fakeGit({
      "rev-parse --is-shallow-repository": "true",
      "fetch --unshallow --filter=blob:none": "",
    });
    expect(deepenShallowClone(exec)).toBe("unshallowed");
    expect(exec).not.toHaveBeenCalledWith("git", ["fetch", "--deepen=500"], expect.anything());
  });

  it("falls back to a bounded deepen when unshallow is refused", () => {
    const exec = fakeGit({
      "rev-parse --is-shallow-repository": "true",
      "fetch --unshallow --filter=blob:none": new Error("refused"),
      "fetch --deepen=500": "",
    });
    expect(deepenShallowClone(exec)).toBe("deepened");
  });

  it("keeps the build going when every fetch fails (no network)", () => {
    const exec = fakeGit({
      "rev-parse --is-shallow-repository": "true",
      "fetch --unshallow --filter=blob:none": new Error("offline"),
      "fetch --deepen=500": new Error("offline"),
    });
    expect(() => deepenShallowClone(exec)).not.toThrow();
    expect(deepenShallowClone(exec)).toBe("failed");
  });
});
