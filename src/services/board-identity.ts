import type { Message } from "discord.js";

// Board messages are found by the message id saved in the guild's settings. When that id is lost (a channel was changed,
// the row was reset), each board looks through the channel's recent messages for its own post. Until 9.0.5 that relied on
// a footer such as "Guilded race board • <guild id> • …", which members saw as noise. Footers are now plain help text,
// and a board is recognised by its title in either language; the old footer prefix still matches posts made before.

/** True when `message` is this bot's post for the board with this legacy footer `marker` and these titles (all languages). */
export function isOwnBoard(message: Pick<Message, "author" | "embeds">, botId: string, marker: string, titles: readonly string[]): boolean {
  return message.author.id === botId && message.embeds.some(embed => Boolean(embed.footer?.text?.startsWith(`${marker} •`) || (embed.title && titles.includes(embed.title))));
}
