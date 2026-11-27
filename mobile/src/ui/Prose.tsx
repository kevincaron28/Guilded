import { Linking, Text, View } from "react-native";
import { colors } from "./theme";

// A small reader for the Markdown the app ships as text (the privacy policy, generated from docs/PRIVACY.md; the help pages):
// paragraphs, "- " bullets, **bold**, `code` and [links](https://...). Links open outside the app; nothing else is interpreted.

type Piece = { text: string; bold?: boolean; code?: boolean; url?: string };

/** Splits one line of Markdown into styled pieces. */
export function inlinePieces(line: string): Piece[] {
  const pieces: Piece[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) pieces.push({ text: line.slice(last, match.index) });
    if (match[1] !== undefined) pieces.push({ text: match[1], bold: true });
    else if (match[2] !== undefined) pieces.push({ text: match[2], code: true });
    else pieces.push({ text: match[3]!, url: match[4]! });
    last = match.index + match[0].length;
  }
  if (last < line.length) pieces.push({ text: line.slice(last) });
  return pieces.length ? pieces : [{ text: line }];
}

/** Paragraphs and bullet lists: blank lines split blocks; lines starting with "- " or "* " are bullets (an indented one is nested). */
export function proseBlocks(markdown: string): { kind: "p" | "li"; depth: number; text: string }[] {
  const blocks: { kind: "p" | "li"; depth: number; text: string }[] = [];
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(raw);
    const last = blocks[blocks.length - 1];
    if (!raw.trim()) { blocks.push({ kind: "p", depth: 0, text: "" }); continue; }
    if (bullet) blocks.push({ kind: "li", depth: bullet[1]!.length >= 2 ? 1 : 0, text: bullet[2]! });
    else if (last && last.text) last.text += ` ${raw.trim()}`;
    else if (last && !last.text && last.kind === "p") last.text = raw.trim();
    else blocks.push({ kind: "p", depth: 0, text: raw.trim() });
  }
  return blocks.filter((block) => block.text);
}

function Line({ text }: { text: string }) {
  return <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>
    {inlinePieces(text).map((piece, i) => piece.url
      ? <Text key={i} accessibilityRole="link" onPress={() => void Linking.openURL(piece.url!).catch(() => {})} style={{ color: colors.gold, textDecorationLine: "underline" }}>{piece.text}</Text>
      : <Text key={i} style={piece.bold ? { fontWeight: "700" } : piece.code ? { fontFamily: "monospace", color: colors.gold } : undefined}>{piece.text}</Text>)}
  </Text>;
}

export function Prose({ markdown }: { markdown: string }) {
  return <View style={{ gap: 10 }}>
    {proseBlocks(markdown).map((block, i) => block.kind === "li"
      ? <View key={i} style={{ flexDirection: "row", gap: 8, paddingLeft: block.depth * 16 }}><Text style={{ color: colors.gold, fontSize: 14, lineHeight: 21 }}>•</Text><View style={{ flex: 1 }}><Line text={block.text} /></View></View>
      : <Line key={i} text={block.text} />)}
  </View>;
}
