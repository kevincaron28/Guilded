/* global Request, Response */
import { afterEach, describe, expect, it, vi } from "vitest";
import { androidDownload, hostedDownload } from "../worker/index.mjs";

// The installer comes from the bot's server (Caddy file_server); the Worker passes the body through.
const env = { GUILDED_ORIGIN_TOKEN: "origin-token", GUILDED_ORIGIN_URL: "https://bot.example.org/" };
const get = (path, method = "GET", headers = {}) => hostedDownload(new Request(`https://guilded.kcaron.top${path}`, { method, headers }), env, { waitUntil() {} });
afterEach(() => vi.unstubAllGlobals());

describe("companion installer served from the bot's server (8 Nov 2026)", () => {
  it("streams the server's file with its length, a download name and the origin credential", async () => {
    const fetchMock = vi.fn(async () => new Response("hello world", { status: 200, headers: { "content-length": "11", "accept-ranges": "bytes", etag: '"abc"', server: "Caddy" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await get("/downloads/Guilded.Companion.Setup.exe");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");
    expect(response.headers.get("content-length")).toBe("11");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("server")).toBeNull();
    expect(response.headers.get("content-disposition")).toContain("Guilded.Companion.Setup.exe");
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe("https://bot.example.org/downloads/Guilded.Companion.Setup.exe");
    expect(init.headers.get("x-guilded-origin")).toBe("origin-token");
  });
  it("passes a resume (Range) through and answers HEAD without a body", async () => {
    const fetchMock = vi.fn(async () => new Response("world", { status: 206, headers: { "content-range": "bytes 6-10/11", "content-length": "5" } }));
    vi.stubGlobal("fetch", fetchMock);
    const partial = await get("/downloads/Guilded.Companion.Setup.9.0.6.exe", "GET", { range: "bytes=6-" });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 6-10/11");
    expect(fetchMock.mock.calls[0][1].headers.get("range")).toBe("bytes=6-");
    const head = await get("/downloads/Guilded.Companion.Setup.9.0.6.exe", "HEAD");
    expect(head.body).toBeNull();
  });
  it("tries the next address, then falls back to the GitHub release", async () => {
    const fetchMock = vi.fn(async () => new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const missing = await get("/downloads/Guilded.Companion.Setup.exe");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(missing.status).toBe(302);
    expect(missing.headers.get("location")).toContain("github.com/kevincaron28/Guilded/releases/latest");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unreachable"); }));
    expect((await get("/downloads/Guilded.Companion.Setup.exe")).status).toBe(302);
  });
  it("falls back to the same version's GitHub asset for a versioned name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const response = await get("/downloads/Guilded.Companion.Setup.9.0.6.exe");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.com/kevincaron28/Guilded/releases/download/v9.0.6/Guilded.Companion.Setup.9.0.6.exe");
  });
  it("redirects to the optional mirror when it has the file, and skips it when it does not", async () => {
    const mirrorEnv = { ...env, GUILDED_DOWNLOAD_MIRROR_URL: "https://dl.example.org/" };
    const ask = () => hostedDownload(new Request("https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe"), mirrorEnv, { waitUntil() {} });
    const fetchMock = vi.fn(async (target) => target.startsWith("https://dl.example.org/") ? new Response(null, { status: 200 }) : new Response("x", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const hit = await ask();
    expect(hit.status).toBe(302);
    expect(hit.headers.get("location")).toBe("https://dl.example.org/Guilded.Companion.Setup.exe");
    expect(fetchMock.mock.calls[0][1].method).toBe("HEAD");
    vi.stubGlobal("fetch", vi.fn(async (target) => target.startsWith("https://dl.example.org/") ? new Response(null, { status: 404 }) : new Response("body", { status: 200 })));
    expect(await (await ask()).text()).toBe("body");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await ask()).headers.get("location")).toContain("github.com");
  });
  it("puts the mirror object's ETag in the redirect so a new release is never served from the old cached file", async () => {
    const mirrorEnv = { ...env, GUILDED_DOWNLOAD_MIRROR_URL: "https://dl.example.org/" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { etag: '"485460fd-e3ef"' } })));
    const hit = await hostedDownload(new Request("https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe"), mirrorEnv, { waitUntil() {} });
    expect(hit.headers.get("location")).toBe("https://dl.example.org/Guilded.Companion.Setup.exe?e=485460fde3ef");
  });
  it("ignores a mirror address that is not plain https", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("body", { status: 200 })));
    const bad = await hostedDownload(new Request("https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe"), { ...env, GUILDED_DOWNLOAD_MIRROR_URL: "http://dl.example.org" }, { waitUntil() {} });
    expect(bad.status).toBe(200);
  });
  it("ignores other paths and refuses writes", async () => {
    expect(await get("/downloads/Guilded-v9.0.4-forever.zip")).toBeNull();
    expect(await get("/downloads/../secret.exe")).toBeNull();
    expect((await get("/downloads/Guilded.Companion.Setup.exe", "POST")).status).toBe(405);
  });
});

describe("Android app (APK) redirect to the R2 mirror (9 Nov 2026)", () => {
  const ask = (path, method = "GET") => androidDownload(new Request(`https://guilded.kcaron.top${path}`, { method }));
  it("redirects the short and versioned names to dl.kcaron.top", () => {
    for (const name of ["Guilded-Android.apk", "Guilded-Android-0.2.0-preview-2.apk"]) {
      const response = ask(`/downloads/${name}`);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`https://dl.kcaron.top/${name}`);
    }
  });
  it("ignores other paths and refuses writes", () => {
    expect(ask("/downloads/other.apk")).toBeNull();
    expect(ask("/downloads/Guilded-Android.apk/../x")).toBeNull();
    expect(ask("/downloads/Guilded-Android.apk", "POST").status).toBe(405);
  });
});
