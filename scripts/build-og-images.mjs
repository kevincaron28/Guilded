// Open Graph share images (1200 x 630) per site section: a painting from site/images/web with a dark left side and the title drawn on it.
// Run by hand after the pictures change (`node scripts/build-og-images.mjs`); the JPEGs under site/images/social/ are committed, so the
// site build and CI never need fonts. Titles are plain text in English; the paintings carry no text.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

export const OG_IMAGES = [
  { name: "home", art: "season-banner-1600.webp", title: "Guilded", sub: "Your guild, connected." },
  { name: "leaderboards", art: "season-banner-1600.webp", title: "Leaderboards", sub: "Dungeons, duels, players and guilds" },
  { name: "dungeons", art: "header-dungeons-1600.webp", title: "Dungeon leaderboards", sub: "Who is fastest this season" },
  { name: "duels", art: "header-duels-1600.webp", title: "Duel ladder", sub: "Rating, record and recent duels" },
  { name: "players", art: "header-players-1600.webp", title: "Character rankings", sub: "Dungeon score by level bracket" },
  { name: "guilds", art: "header-guilds-1600.webp", title: "Guild rankings", sub: "Guilds ranked by their members" },
  { name: "community", art: "tile-guild-800.webp", title: "Community", sub: "Guilds, raids and players on WoW Forever" },
  { name: "guide", art: "tile-players-800.webp", title: "Guides", sub: "Install, link and play in a few steps" },
  { name: "companion", art: "companion-hero-1600.webp", title: "Windows companion", sub: "Free. Sends your data to Discord and the site" },
  { name: "download", art: "tile-officers-800.webp", title: "Download Guilded", sub: "Addon, companion and Discord bot" },
];

const escape = (text) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const overlay = ({ title, sub }) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#0e0b08" stop-opacity=".95"/><stop offset=".55" stop-color="#0e0b08" stop-opacity=".78"/><stop offset="1" stop-color="#0e0b08" stop-opacity=".1"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<rect x="64" y="236" width="72" height="4" fill="#e0b85a"/>
<text x="64" y="320" font-family="Georgia, 'Times New Roman', serif" font-size="68" font-weight="700" fill="#f4efe3">${escape(title)}</text>
<text x="64" y="378" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#d9cfb8">${escape(sub)}</text>
<text x="64" y="560" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" letter-spacing="4" fill="#e0b85a">GUILDED · GUILDEDWOW.COM</text></svg>`);

if (process.argv[1]?.endsWith("build-og-images.mjs")) {
  mkdirSync("site/images/social", { recursive: true });
  for (const image of OG_IMAGES) {
    await sharp(`site/images/web/${image.art}`).resize(1200, 630, { fit: "cover", position: "right" })
      .composite([{ input: overlay(image) }]).jpeg({ quality: 78, mozjpeg: true }).toFile(`site/images/social/og-${image.name}.jpg`);
    console.log("og-" + image.name);
  }
}
