import type { EmbedBuilder } from "discord.js";

// Keep whole rows and custom emoji tokens when a large roster needs truncation.
export function clipRosterLines(lines: string[], max = 1000): string {
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    const next = text ? `${text}\n${lines[i]}` : lines[i] ?? "";
    const remaining = lines.length - i - 1;
    const reserve = remaining ? `\n… +${remaining}`.length : 0;
    if (next.length + reserve > max) {
      const suffix = `… +${lines.length - i}`;
      return text ? `${text}\n${suffix}` : suffix.length <= max ? suffix : "…";
    }
    text = next;
  }
  return text || "—";
}

export function boundRosterEmbed(embed: EmbedBuilder): EmbedBuilder {
  const data = embed.toJSON();
  const fields = data.fields ?? [];
  const fixed = (data.title?.length ?? 0) + (data.description?.length ?? 0) + (data.footer?.text.length ?? 0)
    + (data.author?.name.length ?? 0) + fields.reduce((sum, field) => sum + field.name.length, 0);
  let remaining = 6000 - fixed;
  embed.setFields(fields.map((field, index) => {
    const budget = Math.max(1, Math.min(1000, remaining - (fields.length - index - 1)));
    const value = field.value.length <= budget ? field.value : clipRosterLines(field.value.split("\n"), budget);
    remaining -= value.length;
    return { ...field, value };
  }));
  return embed;
}
