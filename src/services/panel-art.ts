import { EmbedBuilder } from "discord.js";
import { siteUrl } from "../site-url.js";

// Painted, unbranded panel pictures for onboarding messages (site/images/discord/panel-<name>.jpg, 1000 x 320, no text or logos).
// The site build publishes them, so Discord loads them from a public URL; a server that cannot reach it just shows the text.
export type PanelArt = "guide" | "rules" | "games" | "invite";
export const PANEL_ARTS: readonly PanelArt[] = ["guide", "rules", "games", "invite"];
export const panelArtUrl = (name: PanelArt): string => siteUrl(`/images/discord/panel-${name}.jpg`);
/** An image-only embed carrying the panel picture, for messages that are plain content. */
export const panelArtEmbed = (name: PanelArt): EmbedBuilder => new EmbedBuilder().setColor(0xd4af37).setImage(panelArtUrl(name));
