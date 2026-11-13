import type { APIEmbed } from "discord.js";
import type { MessageCreateOptions } from "discord.js";

/**
 * Card-only messages (9.3). A queued post stores its full message (the text fallback) and, next to it, `cardOnly`: the reduced
 * message to send when the card was drawn, holding only what the card cannot carry. If the picture could not be drawn (the
 * renderer is busy, an error) the full message goes out as it always did; a post queued before this existed has no `cardOnly`
 * and is delivered exactly as before. Buttons, mentions (`allowedMentions` is set by the delivery) and files are never touched.
 */
export interface CardOnly { /** Replaces the message's text line; absent or empty means no text line. */ content?: string | undefined; embeds: APIEmbed[] }

/** An embed with no text at all: it only carries the picture and the delivery marker (a link Discord does not show). */
export const textlessEmbed = (color?: number): Record<string, number> => ({ ...(color === undefined ? {} : { color }) });

/** The message to send: the card-only one when the card drew and the post has one, else the stored message unchanged. */
export function messageForDelivery(message: MessageCreateOptions, cardOnly: unknown, cardDrawn: boolean): MessageCreateOptions {
  if (!cardDrawn || !cardOnly || typeof cardOnly !== "object") return message;
  const reduced = cardOnly as Partial<CardOnly>;
  if (!Array.isArray(reduced.embeds) || !reduced.embeds.length) return message;
  const rest = { ...message };
  delete rest.content;
  return { ...rest, ...(typeof reduced.content === "string" && reduced.content ? { content: reduced.content } : {}), embeds: reduced.embeds };
}
