import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { classColor } from "../publicApi";

/** A character name in its WoW class colour. */
export function ClassName({ name, className, style }: { name: string; className: string | null; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.name, { color: classColor(className) }, style]} numberOfLines={1}>{name}</Text>;
}

/** The name a character shows: its full display name when it has one. */
export function shownName(character: { name: string; displayName: string | null }): string {
  return character.displayName || character.name;
}

const styles = StyleSheet.create({ name: { fontSize: 14, fontWeight: "600" } });
