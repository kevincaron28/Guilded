import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

/**
 * Android Back for a screen that sits on top of another (a guild page over the boards, the sign-in code over the
 * sign-in form, the second intro screen). While `active`, Back runs `onBack` instead of leaving. Handlers added later
 * run first, so the topmost layer answers; a layer that is not active does nothing and Back falls through.
 */
export function useBack(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { latest.current(); return true; });
    return () => subscription.remove();
  }, [active]);
}
