import { Component, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { buildReport, currentReportScreen, sendErrorReport } from "./crashReport";
import { t, type Lang } from "./i18n";
import { readLang } from "./storage";
import { colors } from "./ui";
import { common } from "./ui/common";

// The top-level safety net (0.4.0): a render error shows a friendly screen with "Try again" instead of a white screen, and
// an optional "Send error report" the person presses on purpose.
interface State { error: Error | null; lang: Lang; sending: boolean; ref: string | null; sendFailed: boolean }

export class ErrorBoundary extends Component<{ origin: string; children: ReactNode }, State> {
  state: State = { error: null, lang: "en", sending: false, ref: null, sendFailed: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)), ref: null, sendFailed: false };
  }

  componentDidCatch(): void {
    // The language the person chose (a stored setting); English if it cannot be read.
    void readLang().then((lang) => this.setState({ lang })).catch(() => {});
  }

  private send = async () => {
    if (!this.state.error || this.state.sending) return;
    this.setState({ sending: true, sendFailed: false });
    try {
      const ref = await sendErrorReport(this.props.origin, buildReport(this.state.error, { version: Constants.expoConfig?.version, platform: Platform.OS, screen: currentReportScreen() }));
      this.setState({ ref, sending: false });
    } catch { this.setState({ sending: false, sendFailed: true }); }
  };

  render() {
    const { error, lang, sending, ref, sendFailed } = this.state;
    if (!error) return this.props.children;
    return <SafeAreaInsetsContext.Consumer>{(insets) => <View style={[styles.frame, { paddingTop: (insets?.top ?? 40) + 12 }]}>
      <ScrollView contentContainerStyle={common.content}>
        <Text style={common.kicker}>GUILDED</Text>
        <Text style={common.title} accessibilityRole="header">{t(lang, "errorTitle")}</Text>
        <Text style={common.intro}>{t(lang, "errorBody")}</Text>
        <Pressable onPress={() => this.setState({ error: null })} accessibilityRole="button" style={common.primary}><Text style={common.primaryText}>{t(lang, "errorRetry")}</Text></Pressable>
        {ref ? <Text style={common.body} accessibilityRole="alert">{t(lang, "errorSent", { ref })}</Text>
          : <Pressable onPress={() => void this.send()} disabled={sending} accessibilityRole="button" style={common.secondary}><Text style={common.secondaryText}>{t(lang, sending ? "errorSending" : "errorSend")}</Text></Pressable>}
        {sendFailed ? <Text style={common.error} accessibilityRole="alert">{t(lang, "errorSendFailed")}</Text> : null}
        <Text style={common.note}>{t(lang, "errorPrivacy")}</Text>
      </ScrollView>
    </View>}</SafeAreaInsetsContext.Consumer>;
  }
}

const styles = StyleSheet.create({ frame: { flex: 1, backgroundColor: colors.bg } });
