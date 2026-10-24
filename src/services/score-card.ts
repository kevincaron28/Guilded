import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { WebResponse } from "./web-app.js";

export interface ScoreCard { title: string; subtitle: string; value: string; detail: string; footer: string }
const fontfile = fileURLToPath(new URL("../../site/fonts/source-serif-latin.ttf", import.meta.url));
const images = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
const escapeText = (text: string) => text.replace(/\p{Cc}/gu, " ").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const background = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#101713"/><rect x="0" y="0" width="12" height="630" fill="#d4af37"/><rect x="54" y="470" width="1092" height="1" fill="#475044"/></svg>');

async function render(card: ScoreCard): Promise<Buffer> {
  const blocks = [
    { text: "GUILDED · DUNGEONS", top: 40, size: 25, height: 35, color: "#d4af37" },
    { text: card.title.slice(0, 100), top: 100, size: 56, height: 85, color: "#f3f1e8" },
    { text: card.subtitle.slice(0, 130), top: 205, size: 30, height: 50, color: "#bfc9bd" },
    { text: card.value.slice(0, 100), top: 280, size: 68, height: 95, color: "#d4af37" },
    { text: card.detail.slice(0, 160), top: 395, size: 28, height: 55, color: "#f3f1e8" },
    { text: card.footer.slice(0, 180), top: 500, size: 23, height: 90, color: "#bfc9bd" }
  ];
  const layers = await Promise.all(blocks.map(async block => ({ left: 60, top: block.top,
    input: await sharp({ text: { text: `<span foreground="${block.color}">${escapeText(block.text || " ")}</span>`,
      font: `Source Serif 4 ${block.size}`, fontfile, width: 1080, height: block.height, rgba: true, wrap: "word-char" } }).png().toBuffer()
  })));
  return sharp(background).composite(layers).png().toBuffer();
}

// Only call after the route has checked public visibility. Cache by the complete
// facts, not a player id, so changed scores immediately get a different image.
// Bound both memory (32 images) and concurrent render work (2 distinct images).
export async function scoreCardResponse(card: ScoreCard, head = false): Promise<WebResponse> {
  const headers = { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (head) return { status: 200, headers, body: "" };
  const key = createHash("sha256").update(JSON.stringify(card)).digest("hex");
  const cached = images.get(key);
  if (cached) return { status: 200, headers, body: "", binaryBody: cached };
  let work = pending.get(key);
  if (!work) {
    if (pending.size >= 2) return { status: 503, headers: { ...headers, "retry-after": "2" }, body: "" };
    work = render(card);
    pending.set(key, work);
  }
  try {
    const binaryBody = await work;
    images.set(key, binaryBody);
    while (images.size > 32) images.delete(images.keys().next().value!);
    return { status: 200, headers, body: "", binaryBody };
  } finally { if (pending.get(key) === work) pending.delete(key); }
}
