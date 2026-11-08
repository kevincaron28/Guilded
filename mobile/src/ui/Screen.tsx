import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { colors } from "./theme";

/** A tab's scrolling page. With `onRefresh`, pulling down refreshes (the spinner shows until it resolves). */
export function Screen({ children, onRefresh }: { children: ReactNode; onRefresh?: () => Promise<unknown> | void }) {
  const [refreshing, setRefreshing] = useState(false);
  const pull = onRefresh ? () => {
    setRefreshing(true);
    void Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
  } : undefined;
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
    refreshControl={pull ? <RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={colors.gold} colors={[colors.gold]} /> : undefined}>
    {children}
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { padding: 24, paddingBottom: 36, gap: 12 } });
