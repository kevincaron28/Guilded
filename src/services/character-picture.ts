import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { WebContext, WebKit, WebResponse, WebRoute } from "./web-app.js";
import { escapeHtml as h, link, SECURITY_HEADERS } from "./web-layout.js";

// Character pictures (9.1, docs/plans/CHARACTER_VISUALS.md, slice 1: storage and upload).
// A member picks a picture for one of their linked characters on /me/pictures/. The browser shrinks it,
// the bot checks the real file type from its bytes, decodes it with pixel limits and re-encodes two WebP
// copies (512 px and a 128 px square thumb); the uploaded file itself, its metadata (EXIF, GPS) and any
// extra frames are never stored. "guild" pictures are served only to signed-in members of that guild
// (the card renderer reads them from the database); "public" ones to anyone. Officers can remove a
// picture (/officer character picture) or switch pictures off for the server; Delete my data removes
// them with the characters. Cards already posted in Discord keep the picture they were drawn with.

export type PictureVisibility = "guild" | "public";
export const PICTURE_LIMITS = {
  /** Decoded upload, after the browser has shrunk it. The Worker caps a whole form at 1 MB. */
  maxBytes: 750_000,
  /** The form field holds a base64 data URL, so the form may be about a third larger than the image. */
  maxForm: 1_000_000,
  maxSide: 4096,
  largeSide: 512,
  thumbSide: 128,
  perDay: 5
} as const;
export const PICTURE_FORM_PATH = "/me/pictures/upload";

export class PictureError extends Error {
  constructor(readonly code: "type" | "size" | "dimensions" | "decode") { super(code); }
}

/** The image type from the file's first bytes, never from its name or the browser's label. */
export function sniffImage(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "png";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** The bytes of a `data:image/...;base64,` value from the upload form, or null. */
export function dataUrlBytes(value: string | null | undefined): Buffer | null {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec((value ?? "").trim());
  if (!match) return null;
  return Buffer.from(match[1]!, "base64");
}

/**
 * Checks and re-encodes an uploaded picture. Throws PictureError for anything that is not a JPEG, PNG or
 * WebP within the limits. Only the first frame is read; sharp writes no metadata unless asked to.
 */
export async function processPicture(bytes: Buffer): Promise<{ large: Buffer; thumb: Buffer }> {
  if (bytes.length === 0 || bytes.length > PICTURE_LIMITS.maxBytes) throw new PictureError("size");
  if (!sniffImage(bytes)) throw new PictureError("type");
  const open = () => sharp(bytes, { animated: false, failOn: "error", limitInputPixels: PICTURE_LIMITS.maxSide * PICTURE_LIMITS.maxSide });
  let meta;
  try { meta = await open().metadata(); } catch { throw new PictureError("decode"); }
  if (!meta.width || !meta.height) throw new PictureError("decode");
  if (meta.width > PICTURE_LIMITS.maxSide || meta.height > PICTURE_LIMITS.maxSide) throw new PictureError("dimensions");
  try {
    // rotate() applies the camera's orientation before the metadata is dropped.
    const large = await open().rotate().resize(PICTURE_LIMITS.largeSide, PICTURE_LIMITS.largeSide, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    const thumb = await open().rotate().resize(PICTURE_LIMITS.thumbSide, PICTURE_LIMITS.thumbSide, { fit: "cover", position: sharp.strategy.attention }).webp({ quality: 78 }).toBuffer();
    return { large, thumb };
  } catch { throw new PictureError("decode"); }
}

export interface MyPictureCharacter {
  id: string; name: string; realm: string; className: string; guildId: string; guildName: string; enabled: boolean;
  picture: { version: number; visibility: PictureVisibility; status: string } | null;
}
export interface StoredPicture { guildId: string; version: number; visibility: PictureVisibility; status: string; enabled: boolean; large: Buffer; thumb: Buffer }
export interface PictureStore {
  /** The account's own linked characters in the given (verified) guilds. */
  myCharacters(discordUserId: string, guildIds: string[]): Promise<MyPictureCharacter[]>;
  save(characterId: string, guildId: string, images: { large: Buffer; thumb: Buffer }, visibility: PictureVisibility): Promise<number>;
  setVisibility(characterId: string, visibility: PictureVisibility): Promise<void>;
  removeOwn(characterId: string): Promise<void>;
  image(characterId: string): Promise<StoredPicture | null>;
}
export interface PictureAccess {
  guilds(discordUserId: string): Promise<{ id: string; name: string }[]>;
  authorize(discordUserId: string, guildId: string): Promise<unknown>;
}

export const visibilityOf = (value: unknown): PictureVisibility => value === "public" ? "public" : "guild";

// Prisma's Bytes columns take a Uint8Array over a plain ArrayBuffer.
const column = (bytes: Buffer) => new Uint8Array(bytes);

export function prismaPictureStore(database: PrismaClient): PictureStore {
  return {
    async myCharacters(discordUserId, guildIds) {
      if (!guildIds.length) return [];
      const rows = await database.character.findMany({
        where: { member: { discordUserId, status: "ACTIVE", guildId: { in: guildIds } } },
        select: { id: true, name: true, displayName: true, realm: true, className: true, isMain: true,
          member: { select: { guildId: true, guild: { select: { name: true, settings: { select: { characterPicturesEnabled: true } } } } } },
          picture: { select: { version: true, visibility: true, status: true } } },
        orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 60
      });
      return rows.map(row => ({
        id: row.id, name: row.displayName ?? row.name, realm: row.realm, className: row.className, guildId: row.member.guildId, guildName: row.member.guild.name,
        enabled: row.member.guild.settings?.characterPicturesEnabled !== false,
        picture: row.picture ? { version: row.picture.version, visibility: visibilityOf(row.picture.visibility), status: row.picture.status } : null
      }));
    },
    async save(characterId, guildId, images, visibility) {
      const row = await database.characterPicture.upsert({
        where: { characterId },
        create: { characterId, guildId, large: column(images.large), thumb: column(images.thumb), visibility },
        update: { guildId, large: column(images.large), thumb: column(images.thumb), visibility, status: "ok", source: "upload", removedById: null, removedAt: null, version: { increment: 1 } },
        select: { version: true }
      });
      return row.version;
    },
    async setVisibility(characterId, visibility) {
      await database.characterPicture.updateMany({ where: { characterId, status: "ok" }, data: { visibility } });
    },
    async removeOwn(characterId) {
      await database.characterPicture.deleteMany({ where: { characterId } });
    },
    async image(characterId) {
      const row = await database.characterPicture.findUnique({
        where: { characterId },
        select: { guildId: true, version: true, visibility: true, status: true, large: true, thumb: true,
          character: { select: { member: { select: { guild: { select: { settings: { select: { characterPicturesEnabled: true } } } } } } } } }
      });
      if (!row) return null;
      return { guildId: row.guildId, version: row.version, visibility: visibilityOf(row.visibility), status: row.status,
        enabled: row.character.member.guild.settings?.characterPicturesEnabled !== false, large: Buffer.from(row.large), thumb: Buffer.from(row.thumb) };
    }
  };
}

/**
 * An officer removes a member's picture. The row stays (bytes cleared, status "removed") as the record of who
 * removed it and when; the member can pick a new one. Returns false when the character has no picture.
 */
export async function removePictureByOfficer(database: Pick<PrismaClient, "characterPicture">, guildId: string, characterId: string, officerMemberId: string, now = new Date()): Promise<boolean> {
  const result = await database.characterPicture.updateMany({
    where: { characterId, guildId, status: "ok" },
    data: { status: "removed", large: new Uint8Array(0), thumb: new Uint8Array(0), removedById: officerMemberId, removedAt: now, version: { increment: 1 } }
  });
  return result.count > 0;
}

/** The address of a stored picture; the version in it changes with every new picture. */
export const pictureUrl = (characterId: string, version: number, size: "large" | "thumb" = "large") =>
  `/players/pictures/${characterId}/${version}${size === "thumb" ? "-thumb" : ""}.webp`;
const IMAGE_PATH = /^\/players\/pictures\/([a-z0-9]{20,40})\/(\d{1,9})(-thumb)?\.webp$/;

// Only the browser-side shrink step runs as script on the upload page; the page's CSP allows exactly this text.
const SHRINK_SCRIPT = `for(const f of document.querySelectorAll("form[data-picture]")){const file=f.querySelector("input[type=file]"),out=f.querySelector("input[name=image]"),err=f.querySelector("[data-error]");let busy=null;`
  + `const shrink=async()=>{out.value="";const pick=file.files&&file.files[0];if(!pick)return;const bmp=await createImageBitmap(pick);const s=Math.min(1,1280/Math.max(bmp.width,bmp.height));const c=document.createElement("canvas");`
  + `c.width=Math.max(1,Math.round(bmp.width*s));c.height=Math.max(1,Math.round(bmp.height*s));c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);let q=.88,d=c.toDataURL("image/jpeg",q);`
  + `while(d.length>${Math.floor(PICTURE_LIMITS.maxBytes * 1.3)}&&q>.3){q-=.15;d=c.toDataURL("image/jpeg",q)}out.value=d};`
  + `file.addEventListener("change",()=>{err.hidden=true;busy=shrink().catch(()=>{out.value=""})});`
  + `f.addEventListener("submit",e=>{if(out.value)return;e.preventDefault();(busy||shrink()).catch(()=>{}).then(()=>{if(out.value)f.submit();else err.hidden=false})})}`;
const SCRIPT_HASH = createHash("sha256").update(SHRINK_SCRIPT).digest("base64");
const PAGE_CSP = SECURITY_HEADERS["content-security-policy"].replace("img-src 'self' data:", "img-src 'self' data: blob:") + `; script-src 'sha256-${SCRIPT_HASH}'`;

export function createPicturePages(store: PictureStore, access: PictureAccess, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const uploads = new Map<string, number[]>();
  const members = new Map<string, { ok: boolean; at: number }>();
  const MEMBER_TTL = 5 * 60_000;

  async function isMember(discordUserId: string, guildId: string): Promise<boolean> {
    const key = `${discordUserId}:${guildId}`;
    const cached = members.get(key);
    if (cached && now() - cached.at < MEMBER_TTL) return cached.ok;
    const ok = Boolean(await access.authorize(discordUserId, guildId).catch(() => null));
    if (members.size > 5_000) members.clear();
    members.set(key, { ok, at: now() });
    return ok;
  }
  function allowUpload(discordUserId: string): boolean {
    const recent = (uploads.get(discordUserId) ?? []).filter(at => now() - at < 86_400_000);
    uploads.set(discordUserId, recent);
    if (recent.length >= PICTURE_LIMITS.perDay) return false;
    recent.push(now());
    return true;
  }

  async function serveImage(ctx: WebContext): Promise<WebResponse | null> {
    const match = IMAGE_PATH.exec(ctx.request.path);
    if (!match) return null;
    const notFound: WebResponse = { status: 404, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" }, body: "Not found" };
    if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
    const picture = await store.image(match[1]!);
    if (!picture || picture.status !== "ok" || !picture.enabled || picture.version !== Number(match[2])) return notFound;
    if (picture.visibility !== "public" && !(ctx.account && await isMember(ctx.account.discordUserId, picture.guildId))) return notFound;
    const bytes = match[3] ? picture.thumb : picture.large;
    return { status: 200, body: "", ...(ctx.request.method === "HEAD" ? {} : { binaryBody: bytes }), headers: {
      ...SECURITY_HEADERS, "content-type": "image/webp", "content-length": String(bytes.length), "content-disposition": "inline",
      "cache-control": picture.visibility === "public" ? "public, max-age=86400, immutable" : "private, max-age=86400, immutable"
    } };
  }

  async function myCharacters(ctx: WebContext) {
    const guilds = await access.guilds(ctx.account!.discordUserId);
    return store.myCharacters(ctx.account!.discordUserId, guilds.map(guild => guild.id));
  }

  function managePage(ctx: WebContext, kit: WebKit, characters: MyPictureCharacter[], status = 200, notice = ""): WebResponse {
    const { t, lang } = ctx;
    const csrf = `<input type="hidden" name="csrf" value="${h(ctx.csrf ?? "")}">`;
    const option = (value: PictureVisibility, current: PictureVisibility, label: string) => `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
    const visibilityField = (current: PictureVisibility) => `<label>${t("Who sees it", "Qui la voit")} <select name="visibility">${option("guild", current, t("My guild only", "Ma guilde seulement"))}${option("public", current, t("Public (also public pages)", "Public (aussi les pages publiques)"))}</select></label>`;
    const blocks = characters.map(character => {
      const hidden = `<input type="hidden" name="character" value="${h(character.id)}">`;
      const current = character.picture?.status === "ok" ? character.picture : null;
      const head = `<h2>${h(character.name)} <small>${h(character.className)} · ${h(character.guildName)}</small></h2>`;
      if (!character.enabled) return `<section>${head}<p>${t("The officers of this guild turned character pictures off.", "Les officiers de cette guilde ont désactivé les images de personnage.")}</p></section>`;
      const shown = current
        ? `<p><img src="${h(pictureUrl(character.id, current.version))}" alt="${h(character.name)}" width="160" style="max-width:160px;height:auto;border-radius:8px"></p>`
          + `<form method="post" action="${link("/me/pictures/visibility", lang)}">${csrf}${hidden}${visibilityField(current.visibility)} <button type="submit">${t("Save", "Enregistrer")}</button></form>`
          + `<form method="post" action="${link("/me/pictures/remove", lang)}">${csrf}${hidden}<button type="submit">${t("Remove picture", "Retirer l'image")}</button></form>`
        : character.picture?.status === "removed" ? `<p class="notice">${t("An officer removed this character's picture. You can pick another one.", "Un officier a retiré l'image de ce personnage. Vous pouvez en choisir une autre.")}</p>` : "";
      const upload = `<form method="post" action="${link(PICTURE_FORM_PATH, lang)}" data-picture>${csrf}${hidden}<input type="hidden" name="image">`
        + `<p><label>${current ? t("New picture", "Nouvelle image") : t("Picture", "Image")} <input type="file" accept="image/jpeg,image/png,image/webp" required></label></p>`
        + `<p>${visibilityField(current?.visibility ?? "guild")}</p>`
        + `<p><label><input type="checkbox" name="own" value="1" required> ${t("This is my own screenshot or image, and it shows my character, not a real person.", "C'est ma propre capture ou image, et elle montre mon personnage, pas une vraie personne.")}</label></p>`
        + `<p data-error hidden class="notice">${t("That file could not be read as a picture. Pick a JPEG, PNG or WebP image (JavaScript must be on to shrink it).", "Ce fichier n'a pas pu être lu comme une image. Choisissez une image JPEG, PNG ou WebP (JavaScript doit être activé pour la réduire).")}</p>`
        + `<button class="button" type="submit">${t("Save picture", "Enregistrer l'image")}</button></form>`;
      return `<section>${head}${shown}${upload}</section>`;
    }).join("");
    const body = `<h1>${t("Character pictures", "Images de personnage")}</h1>`
      + (notice ? `<p class="notice">${notice}</p>` : "")
      + `<p>${t("Pick a picture for a character: a screenshot, the image the armory exports, or art you own. It is shown on that character's cards and profile, to your guild only unless you choose Public.", "Choisissez une image pour un personnage : une capture d'écran, l'image exportée par l'armurerie ou une illustration qui vous appartient. Elle apparaît sur les cartes et le profil de ce personnage, pour votre guilde seulement sauf si vous choisissez Public.")}</p>`
      + `<p>${t(`Your browser shrinks the picture first; Guilded keeps only a ${PICTURE_LIMITS.largeSide} px copy and a small thumbnail, without the file's hidden details (camera, location). Up to ${PICTURE_LIMITS.perDay} new pictures a day. Officers can remove a picture or turn pictures off for the server. Cards already posted in Discord keep the picture they were drawn with; removing it here stops new ones.`, `Votre navigateur réduit d'abord l'image; Guilded ne garde qu'une copie de ${PICTURE_LIMITS.largeSide} px et une vignette, sans les détails cachés du fichier (appareil, lieu). Jusqu'à ${PICTURE_LIMITS.perDay} nouvelles images par jour. Les officiers peuvent retirer une image ou désactiver les images pour le serveur. Les cartes déjà publiées dans Discord gardent l'image avec laquelle elles ont été dessinées; la retirer ici arrête les nouvelles.`)}</p>`
      + (blocks || `<p>${t("No linked character in a guild you belong to. Link your characters first (Guilded app or /character pair).", "Aucun personnage lié dans une guilde dont vous êtes membre. Liez d'abord vos personnages (application Guilded ou /character pair).")}</p>`)
      + `<p><a href="${link("/me/", lang)}">${t("Back to my page", "Retour à ma page")}</a></p><script>${SHRINK_SCRIPT}</script>`;
    const page = kit.page(status, t("Character pictures", "Images de personnage"), body, { noindex: true });
    return { ...page, headers: { ...page.headers, "content-security-policy": PAGE_CSP } };
  }

  const route: WebRoute = async (ctx, kit) => {
    const image = await serveImage(ctx);
    if (image) return image;
    const path = ctx.request.path;
    if (!path.startsWith("/me/pictures")) return null;
    if (!ctx.account) return kit.signInPrompt();
    const { t, lang } = ctx;
    if (path === "/me/pictures" || path === "/me/pictures/") {
      if (!["GET", "HEAD"].includes(ctx.request.method)) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" }, body: "" };
      const done = ctx.request.query.get("done");
      const notices: Record<string, string> = {
        saved: t("Picture saved.", "Image enregistrée."), removed: t("Picture removed.", "Image retirée."), visibility: t("Saved.", "Enregistré.")
      };
      return managePage(ctx, kit, await myCharacters(ctx), 200, done ? notices[done] ?? "" : "");
    }
    // POSTs reach here only from this site, signed in, with the session's CSRF token (web-app.ts checks).
    if (ctx.request.method !== "POST" || !ctx.form) return { status: 405, headers: { ...SECURITY_HEADERS, allow: "POST" }, body: "" };
    const characters = await myCharacters(ctx);
    const character = characters.find(row => row.id === ctx.form!.get("character"));
    const fail = (status: number, message: string) => managePage(ctx, kit, characters, status, message);
    if (!character) return fail(404, t("That character is not one of yours.", "Ce personnage n'est pas l'un des vôtres."));
    if (!character.enabled) return fail(403, t("The officers of this guild turned character pictures off.", "Les officiers de cette guilde ont désactivé les images de personnage."));
    const done = (what: string) => kit.redirect(link("/me/pictures/", lang, { done: what }));
    if (path === "/me/pictures/remove") { await store.removeOwn(character.id); return done("removed"); }
    if (path === "/me/pictures/visibility") { await store.setVisibility(character.id, visibilityOf(ctx.form.get("visibility"))); return done("visibility"); }
    if (path !== PICTURE_FORM_PATH) return null;
    if (ctx.form.get("own") !== "1") return fail(400, t("Confirm that the picture is your own and shows your character.", "Confirmez que l'image vous appartient et montre votre personnage."));
    const bytes = dataUrlBytes(ctx.form.get("image"));
    if (!bytes) return fail(400, t("Pick a JPEG, PNG or WebP picture (JavaScript must be on to shrink it).", "Choisissez une image JPEG, PNG ou WebP (JavaScript doit être activé pour la réduire)."));
    let images;
    try { images = await processPicture(bytes); }
    catch (error) {
      const code = error instanceof PictureError ? error.code : "decode";
      return fail(400, code === "size" ? t("That picture is too large even after shrinking. Try a smaller one.", "Cette image est trop grande même réduite. Essayez-en une plus petite.")
        : code === "dimensions" ? t(`Pictures can be at most ${PICTURE_LIMITS.maxSide} pixels wide or tall.`, `Les images peuvent mesurer au plus ${PICTURE_LIMITS.maxSide} pixels de large ou de haut.`)
        : t("That file is not a JPEG, PNG or WebP picture.", "Ce fichier n'est pas une image JPEG, PNG ou WebP."));
    }
    if (!allowUpload(ctx.account.discordUserId)) return fail(429, t(`You can save up to ${PICTURE_LIMITS.perDay} new pictures a day. Try again tomorrow.`, `Vous pouvez enregistrer jusqu'à ${PICTURE_LIMITS.perDay} nouvelles images par jour. Réessayez demain.`));
    await store.save(character.id, character.guildId, images, visibilityOf(ctx.form.get("visibility")));
    return done("saved");
  };

  const meSection = async (ctx: WebContext) => ctx.account
    ? `<h2>${ctx.t("Character pictures", "Images de personnage")}</h2><p><a href="${link("/me/pictures/", ctx.lang)}">${ctx.t("Pick a picture for your characters' cards and profile", "Choisir une image pour les cartes et le profil de vos personnages")}</a></p>`
    : "";
  return { route, meSection, isMember };
}
