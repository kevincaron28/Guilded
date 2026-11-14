import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/hosted-pilot.js", () => ({ pilotGuildScope: {} }));
import { sendWithPictureFallback } from "../src/services/discord-jobs.js";

const withPicture = { embeds: [], files: [{ attachment: Buffer.from("png") }] } as never;
const refused = (code: number) => Object.assign(new Error(`Discord ${code}`), { code });

describe("sendWithPictureFallback", () => {
  it.each([50013, 40005])("posts the stored text once, without files, when Discord refuses the picture (%i)", async code => {
    const send = vi.fn().mockRejectedValueOnce(refused(code)).mockResolvedValue({});
    const plain = vi.fn(() => ({ content: "full text" }));
    await sendWithPictureFallback(send, withPicture, plain);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toEqual({ content: "full text" });
    expect(plain).toHaveBeenCalledTimes(1);
  });

  it("rethrows any other error and does not post a second time", async () => {
    const send = vi.fn().mockRejectedValue(refused(500));
    await expect(sendWithPictureFallback(send, withPicture, () => ({ content: "t" }))).rejects.toThrow("Discord 500");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rethrows a refusal when the post has no text version, and when the text version is refused too", async () => {
    await expect(sendWithPictureFallback(vi.fn().mockRejectedValue(refused(50013)), withPicture, null)).rejects.toThrow("Discord 50013");
    const send = vi.fn().mockRejectedValue(refused(50013));
    await expect(sendWithPictureFallback(send, withPicture, () => ({ content: "t" }))).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("posts once and never builds the text when the picture goes through", async () => {
    const send = vi.fn().mockResolvedValue({});
    const plain = vi.fn(() => ({ content: "t" }));
    await sendWithPictureFallback(send, withPicture, plain);
    expect(send).toHaveBeenCalledTimes(1);
    expect(plain).not.toHaveBeenCalled();
  });
});
