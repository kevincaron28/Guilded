import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Role emblems for the dungeon card's party rows (tank, healer, damage), as SVG markup the card kit can draw.
 * Two looks, both made from code and the owner-approved badge frames (no new artwork):
 *  - "medal": a round metal medallion (bevelled gold rim, role-coloured enamel face, raised glyph), pure vector.
 *  - "frame": the approved painted hexagon frame (site/badge-art/frames) with the glyph in its dark centre.
 */
export type RoleKind = "tank" | "healer" | "dps";
export type RoleStyle = "medal" | "frame";

const FACE = {
  tank: { top: "#5d9cff", bottom: "#17356b", glyph: "#e9f2ff" },
  healer: { top: "#7fe06a", bottom: "#1d5a22", glyph: "#f0ffe9" },
  dps: { top: "#ff7d68", bottom: "#6e1a12", glyph: "#fff0ea" }
} as const;

/** Glyphs on a 64 x 64 grid, filled shapes (the old thin line icons were hard to read at row size). */
const GLYPH = {
  tank: '<path d="M32 9 L51 16 V32 Q51 47 32 56 Q13 47 13 32 V16 Z"/>',
  healer: '<path d="M25 11 H39 V25 H53 V39 H39 V53 H25 V39 H11 V25 H25 Z"/>',
  dps: '<g transform="rotate(40 32 32)"><path d="M29.5 5 H34.5 L35.5 38 H28.5 Z"/><rect x="21" y="38" width="22" height="5" rx="2"/><rect x="29" y="43" width="6" height="11" rx="2"/><circle cx="32" cy="57" r="3.2"/></g><g transform="rotate(-40 32 32)"><path d="M29.5 5 H34.5 L35.5 38 H28.5 Z"/><rect x="21" y="38" width="22" height="5" rx="2"/><rect x="29" y="43" width="6" height="11" rx="2"/><circle cx="32" cy="57" r="3.2"/></g>'
} as const;

const FRAME_FILE = fileURLToPath(new URL("../../site/badge-art/frames/gold-128.webp", import.meta.url));
let frame: Promise<string | null> | undefined;
/** The approved gold frame, as a data URI (null when the file is missing: the medal is drawn instead). */
function frameUri(): Promise<string | null> {
  frame ??= readFile(FRAME_FILE).then(async (file) => `data:image/png;base64,${(await sharp(file).resize(96, 96).png().toBuffer()).toString("base64")}`).catch(() => null);
  return frame;
}

const defs = (role: RoleKind) => {
  const f = FACE[role];
  return `<linearGradient id="medal-${role}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${f.top}"/><stop offset="1" stop-color="${f.bottom}"/></linearGradient>`;
};
const RIM = `<linearGradient id="medalrim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbeab0"/><stop offset=".45" stop-color="#c79a3a"/><stop offset="1" stop-color="#6b4a14"/></linearGradient>`;

/**
 * The emblem for one role at (x, y), `size` pixels square. `used` is the set of gradient ids already written into this card's
 * SVG, so a card with several rows defines each gradient once.
 */
export async function roleEmblem(role: RoleKind, style: RoleStyle, x: number, y: number, size: number, used: Set<string>): Promise<string> {
  const f = FACE[role], k = size / 64;
  let out = "";
  const need = (id: string, markup: string) => { if (!used.has(id)) { used.add(id); out += `<defs>${markup}</defs>`; } };
  const uri = style === "frame" ? await frameUri() : null;
  if (uri) {
    out += `<image x="${x - size * 0.06}" y="${y - size * 0.06}" width="${size * 1.12}" height="${size * 1.12}" href="${uri}"/>`;
    out += `<g transform="translate(${x + size * 0.2} ${y + size * 0.2}) scale(${(size * 0.6) / 64})" fill="${f.glyph}" stroke="#000" stroke-opacity=".55" stroke-width="2" paint-order="stroke">${GLYPH[role]}</g>`;
    return out;
  }
  need("medalrim", RIM); need(`medal-${role}`, defs(role));
  out += `<g transform="translate(${x} ${y}) scale(${k})">`
    + `<circle cx="32" cy="32" r="31" fill="#000" fill-opacity=".5"/>`
    + `<circle cx="32" cy="32" r="30" fill="url(#medalrim)"/>`
    + `<circle cx="32" cy="32" r="24.5" fill="#3a2810"/>`
    + `<circle cx="32" cy="32" r="23" fill="url(#medal-${role})"/>`
    + `<path d="M10 28 A23 23 0 0 1 54 28 Q32 20 10 28 Z" fill="#fff" fill-opacity=".22"/>`
    + `<g transform="translate(32 32) scale(.7) translate(-32 -32)" fill="${f.glyph}" stroke="#000" stroke-opacity=".5" stroke-width="3" paint-order="stroke">${GLYPH[role]}</g>`
    + `</g>`;
  return out;
}
