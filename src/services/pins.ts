import type { GuildTextBasedChannel, Message } from "discord.js";

// A channel's pinned messages. discord.js 14.19+ replaced fetchPinned() (deprecated, logged a
// warning on every startup) with the paged fetchPins(); a channel has at most 50 pins, one page.
// Falls back to fetchPinned() where only that exists (older mocks in tests).
export async function pinnedMessages(channel: GuildTextBasedChannel): Promise<Message[]> {
  const manager = channel.messages as GuildTextBasedChannel["messages"] & {
    fetchPins?: (options?: { limit?: number }) => Promise<{ items: readonly { message: Message }[] }>;
    fetchPinned?: () => Promise<{ values(): IterableIterator<Message> }>;
  };
  if (typeof manager.fetchPins === "function") {
    const page = await manager.fetchPins({ limit: 50 });
    return page.items.map((pin) => pin.message);
  }
  const pinned = await manager.fetchPinned!();
  return [...pinned.values()];
}
