import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  createPicturePages, dataUrlBytes, PICTURE_LIMITS, PictureError, pictureUrl, processPicture, removePictureByOfficer, sniffImage,
  type MyPictureCharacter, type PictureStore, type StoredPicture
} from "../src/services/character-picture.js";
import { webFormLimit, type WebContext, type WebKit } from "../src/services/web-app.js";

const png = (width: number, height: number, withExif = false) => {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png();
  return (withExif ? image.withMetadata({ exif: { IFD0: { Copyright: "secret-camera", Make: "SecretCam" } } }) : image).toBuffer();
};
const dataUrl = (bytes: Buffer, type = "png") => `data:image/${type};base64,${bytes.toString("base64")}`;

describe("checking and re-encoding an upload", () => {
  it("knows the type from the bytes, not the label", async () => {
    expect(sniffImage(await png(4, 4))).toBe("png");
    expect(sniffImage(await sharp(await png(4, 4)).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImage(await sharp(await png(4, 4)).webp().toBuffer())).toBe("webp");
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a......"))).toBeNull();
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toEqual(Buffer.from("AAAA", "base64"));
    expect(dataUrlBytes("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(dataUrlBytes("data:image/png;base64,<script>")).toBeNull();
    expect(dataUrlBytes(null)).toBeNull();
  });
  it("keeps a 512 px WebP and a 128 px square thumb, without the file's metadata", async () => {
    const original = await png(1200, 800, true);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const { large, thumb } = await processPicture(original);
    const largeMeta = await sharp(large).metadata(), thumbMeta = await sharp(thumb).metadata();
    expect([largeMeta.format, largeMeta.width, largeMeta.height]).toEqual(["webp", 512, 341]);
    expect([thumbMeta.format, thumbMeta.width, thumbMeta.height]).toEqual(["webp", 128, 128]);
    expect(largeMeta.exif).toBeUndefined(); expect(thumbMeta.exif).toBeUndefined();
    expect(large.includes(Buffer.from("SecretCam"))).toBe(false);
    // Small pictures are not enlarged.
    expect((await sharp((await processPicture(await png(200, 100))).large).metadata()).width).toBe(200);
  });
  it("refuses other types, broken files, oversize files and huge dimensions", async () => {
    const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error: unknown) => error instanceof PictureError ? error.code : String(error));
    expect(await code(processPicture(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")))).toBe("type");
    expect(await code(processPicture(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])))).toBe("decode");
    expect(await code(processPicture(Buffer.alloc(PICTURE_LIMITS.maxBytes + 1, 0xff)))).toBe("size");
    expect(await code(processPicture(Buffer.alloc(0)))).toBe("size");
    expect(await code(processPicture(await png(PICTURE_LIMITS.maxSide + 1, 8)))).toBe("dimensions");
  });
});

// --- The /me/pictures/ pages and the image route -------------------------------------------------------
const account = { id: "account", discordUserId: "member", username: "Kev", displayName: null };
const kit: WebKit = {
  page: (status, _title, body) => ({ status, headers: { "content-security-policy": "default-src 'none'; img-src 'self' data:" }, body }),
  redirect: (location) => ({ status: 303, headers: { location }, body: "" }),
  signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" })
};
const context = (path: string, options: { method?: string; form?: Record<string, string>; account?: typeof account | null; query?: string } = {}): WebContext => ({
  account: options.account === undefined ? account : options.account,
  request: { path, method: options.method ?? (options.form ? "POST" : "GET"), query: new URLSearchParams(options.query ?? ""), headers: {} },
  lang: "en", t: en => en, now: new Date("2026-11-07T12:00:00Z"), sessionToken: "token", csrf: "csrf", form: options.form ? new URLSearchParams(options.form) : null, auth: null
});
const ownId = "c".repeat(25), otherGuildId = "d".repeat(25), strangerId = "e".repeat(25);

function fakeStore(enabled = { g1: true, g2: false }) {
  const pictures = new Map<string, StoredPicture>();
  const characters: (MyPictureCharacter & { owner: string })[] = [
    { id: ownId, owner: "member", name: "Kev Gold", realm: "Forever", className: "Mage", guildId: "g1", guildName: "Gold", enabled: enabled.g1, picture: null },
    { id: otherGuildId, owner: "member", name: "Kev Alt", realm: "Forever", className: "Rogue", guildId: "g2", guildName: "Off", enabled: enabled.g2, picture: null },
    { id: strangerId, owner: "someone", name: "Other", realm: "Forever", className: "Priest", guildId: "g1", guildName: "Gold", enabled: enabled.g1, picture: null }
  ];
  const store: PictureStore = {
    myCharacters: vi.fn(async (discordUserId: string, guildIds: string[]) => characters.filter(row => row.owner === discordUserId && guildIds.includes(row.guildId)).map(row => {
      const picture = pictures.get(row.id);
      return { ...row, picture: picture ? { version: picture.version, visibility: picture.visibility, status: picture.status } : null };
    })),
    save: vi.fn(async (characterId, guildId, images, visibility) => {
      const version = (pictures.get(characterId)?.version ?? 0) + 1;
      pictures.set(characterId, { guildId, version, visibility, status: "ok", enabled: characters.find(row => row.id === characterId)!.enabled, ...images });
      return version;
    }),
    setVisibility: vi.fn(async (characterId, visibility) => { const row = pictures.get(characterId); if (row) row.visibility = visibility; }),
    removeOwn: vi.fn(async (characterId) => { pictures.delete(characterId); }),
    image: vi.fn(async (characterId) => pictures.get(characterId) ?? null)
  };
  return { store, pictures };
}
const access = (guilds = [{ id: "g1", name: "Gold" }, { id: "g2", name: "Off" }]) => ({
  guilds: vi.fn(async () => guilds),
  authorize: vi.fn(async (discordUserId: string, guildId: string) => discordUserId === "member" || (discordUserId === "guildmate" && guildId === "g1") ? { id: guildId } : null)
});

describe("character picture pages", () => {
  it("lists only the signed-in member's own characters and allows the shrink script and nothing else", async () => {
    const { store } = fakeStore();
    const pages = createPicturePages(store, access());
    expect((await pages.route(context("/me/pictures/", { account: null }), kit))?.status).toBe(401);
    const page = (await pages.route(context("/me/pictures/"), kit))!;
    expect(page.body).toContain("Kev Gold");
    expect(page.body).toContain("turned character pictures off"); // g2 has pictures off
    expect(page.body).not.toContain("Other");
    expect(page.body).toContain("not a real person");
    const csp = String(page.headers["content-security-policy"]);
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("unsafe-inline'; script");
    expect(webFormLimit("/me/pictures/upload")).toBe(PICTURE_LIMITS.maxForm);
    expect(await pages.route(context("/me/other"), kit)).toBeNull();
  });

  it("saves a re-encoded picture for an own character only, with consent, within the daily limit", async () => {
    const { store, pictures } = fakeStore({ g1: true, g2: true });
    const pages = createPicturePages(store, access());
    const image = dataUrl(await png(300, 300));
    const upload = (character: string, extra: Record<string, string> = {}) => pages.route(context("/me/pictures/upload", { form: { character, image, own: "1", visibility: "public", ...extra } }), kit);
    expect((await upload(strangerId))?.status).toBe(404);
    expect((await upload(ownId, { own: "" }))?.status).toBe(400);
    expect((await upload(ownId, { image: "data:text/html;base64,PGI+" }))?.status).toBe(400);
    expect((await upload(ownId, { image: dataUrl(Buffer.from("<svg/>"), "png") }))?.body).toContain("not a JPEG, PNG or WebP");
    expect(store.save).not.toHaveBeenCalled();
    const saved = (await upload(ownId))!;
    expect(saved.status).toBe(303);
    expect(saved.headers["location"]).toContain("done=saved");
    const stored = pictures.get(ownId)!;
    expect(stored.visibility).toBe("public");
    expect((await sharp(stored.thumb).metadata()).format).toBe("webp");
    for (let i = 1; i < PICTURE_LIMITS.perDay; i++) expect((await upload(otherGuildId))?.status).toBe(303);
    expect((await upload(ownId))?.status).toBe(429);
  });

  it("refuses uploads in a guild whose officers turned pictures off", async () => {
    const { store } = fakeStore();
    const pages = createPicturePages(store, access());
    const answer = await pages.route(context("/me/pictures/upload", { form: { character: otherGuildId, image: dataUrl(await png(10, 10)), own: "1" } }), kit);
    expect(answer?.status).toBe(403);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("changes who sees it and removes it", async () => {
    const { store, pictures } = fakeStore();
    const pages = createPicturePages(store, access());
    await pages.route(context("/me/pictures/upload", { form: { character: ownId, image: dataUrl(await png(40, 40)), own: "1" } }), kit);
    expect(pictures.get(ownId)?.visibility).toBe("guild");
    await pages.route(context("/me/pictures/visibility", { form: { character: ownId, visibility: "public" } }), kit);
    expect(pictures.get(ownId)?.visibility).toBe("public");
    await pages.route(context("/me/pictures/visibility", { form: { character: ownId, visibility: "everyone<script>" } }), kit);
    expect(pictures.get(ownId)?.visibility).toBe("guild");
    await pages.route(context("/me/pictures/remove", { form: { character: strangerId } }), kit);
    expect(store.removeOwn).not.toHaveBeenCalled();
    await pages.route(context("/me/pictures/remove", { form: { character: ownId } }), kit);
    expect(pictures.has(ownId)).toBe(false);
  });

  it("serves guild pictures to that guild's members only, public ones to anyone, and never a removed or old version", async () => {
    const { store, pictures } = fakeStore();
    const auth = access();
    const pages = createPicturePages(store, auth);
    await pages.route(context("/me/pictures/upload", { form: { character: ownId, image: dataUrl(await png(400, 300)), own: "1" } }), kit);
    const get = (path: string, viewer: typeof account | null) => pages.route(context(path, { account: viewer }), kit);
    const url = pictureUrl(ownId, 1);
    const mine = (await get(url, account))!;
    expect(mine.status).toBe(200);
    expect(mine.headers["content-type"]).toBe("image/webp");
    expect(String(mine.headers["cache-control"])).toContain("private");
    expect((await sharp(mine.binaryBody!).metadata()).width).toBe(400);
    expect((await sharp((await get(pictureUrl(ownId, 1, "thumb"), account))!.binaryBody!).metadata()).width).toBe(128);
    expect((await get(url, { ...account, discordUserId: "guildmate" }))?.status).toBe(200);
    expect((await get(url, { ...account, discordUserId: "outsider" }))?.status).toBe(404);
    expect((await get(url, null))?.status).toBe(404);
    expect((await get(pictureUrl(ownId, 2), account))?.status).toBe(404);
    pictures.get(ownId)!.visibility = "public";
    expect((await get(url, null))?.status).toBe(200);
    expect(String((await get(url, null))!.headers["cache-control"])).toContain("public");
    pictures.get(ownId)!.enabled = false;
    expect((await get(url, null))?.status).toBe(404);
    pictures.get(ownId)!.enabled = true;
    pictures.get(ownId)!.status = "removed";
    expect((await get(url, null))?.status).toBe(404);
    expect((await get("/players/pictures/../../etc/1.webp", null))).toBeNull();
    // Membership answers are cached for a few minutes, not fetched for every image.
    expect(auth.authorize.mock.calls.filter(([user]) => user === "guildmate")).toHaveLength(1);
  });
});

describe("officer removal and deletion", () => {
  it("clears the bytes, keeps who removed it and bumps the version", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const now = new Date("2026-11-07T00:00:00Z");
    expect(await removePictureByOfficer({ characterPicture: { updateMany } } as never, "g1", ownId, "officer", now)).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { characterId: ownId, guildId: "g1", status: "ok" },
      data: { status: "removed", large: new Uint8Array(0), thumb: new Uint8Array(0), removedById: "officer", removedAt: now, version: { increment: 1 } } });
    updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await removePictureByOfficer({ characterPicture: { updateMany } } as never, "g1", ownId, "officer", now)).toBe(false);
  });
  it("goes with the character (Delete my data deletes the characters), and the server switch is on by default", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toMatch(/model CharacterPicture \{[\s\S]*?character\s+Character\s+@relation\(fields: \[characterId\], references: \[id\], onDelete: Cascade\)/);
    expect(schema).toMatch(/characterPicturesEnabled Boolean @default\(true\)/);
    const migration = readFileSync("prisma/migrations/20270121000000_character_pictures/migration.sql", "utf8");
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain('"characterPicturesEnabled" BOOLEAN NOT NULL DEFAULT true');
    expect(readFileSync("src/services/data-deletion.ts", "utf8")).toContain("tx.character.deleteMany({ where: own })");
  });
});
