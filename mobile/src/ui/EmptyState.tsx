import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { Card } from "./Card";
import { colors } from "./theme";

/** One muted line for "nothing here yet" or "switched off". `boxed` puts it on its own panel. */
export function EmptyState({ message, boxed, style }: { message: string; boxed?: boolean; style?: StyleProp<ViewStyle> }) {
  const text = <Text style={styles.text}>{message}</Text>;
  return boxed ? <Card style={style}>{text}</Card> : text;
}

const styles = StyleSheet.create({ text: { color: colors.muted, fontSize: 13, lineHeight: 20 } });
