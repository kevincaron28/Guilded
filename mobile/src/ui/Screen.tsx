import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { colors } from "./theme";

/** The pull-down spinner for any ScrollView: the spinner shows until `onRefresh` settles. Undefined when there is nothing to refresh. */
export function usePullToRefresh(onRefresh?: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);
  if (!onRefresh) return undefined;
  const pull = () => {
    setRefreshing(true);
    void Promise.resolve(onRefresh()).catch(() => {}).finally(() => setRefreshing(false));
  };
  return <RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.panel} />;
}

/** A tab's scrolling page. With `onRefresh`, pulling down refreshes (the spinner shows until it resolves). */
export function Screen({ children, onRefresh }: { children: ReactNode; onRefresh?: () => Promise<unknown> | void }) {
  const refreshControl = usePullToRefresh(onRefresh);
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
    {children}
  </ScrollView>;
}

const styles = StyleSheet.create({ content: { padding: 24, paddingBottom: 36, gap: 12 } });
