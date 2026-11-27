import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, type TextInputFocusEvent } from "react-native";

// The keyboard must never cover the field being typed in (Testers Community report, 0.7.0: the sign-in code and server ID
// fields were hidden). Since Android 15 apps draw edge to edge and the window no longer shrinks for the keyboard, so a screen
// with text fields: pads its scroll area by the keyboard's height, scrolls the focused field above the keyboard, and offers
// a way to hide the keyboard.

type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };

/** How far to scroll so a field (top `y`, `height`, window coordinates) sits `margin` above the keyboard; 0 when it already shows. */
export function revealOffset(field: { y: number; height: number }, windowHeight: number, keyboardHeight: number, margin = 24): number {
  const visibleBottom = windowHeight - keyboardHeight - margin;
  const below = field.y + field.height - visibleBottom;
  if (below > 0) return below;
  return field.y < margin ? field.y - margin : 0;
}

export function useKeyboardScroll() {
  const scroll = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const focused = useRef<Measurable | null>(null);
  const [height, setHeight] = useState(0);
  const heightRef = useRef(0);

  const adjust = () => {
    const field = focused.current;
    if (!field || !heightRef.current) return;
    setTimeout(() => field.measureInWindow((_x, y, _w, h) => {
      const by = revealOffset({ y, height: h }, Dimensions.get("window").height, heightRef.current);
      if (by) scroll.current?.scrollTo({ y: Math.max(0, offset.current + by), animated: true });
    }), 60);
  };

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => { heightRef.current = event.endCoordinates.height; setHeight(event.endCoordinates.height); adjust(); });
    const hidden = Keyboard.addListener("keyboardDidHide", () => { heightRef.current = 0; setHeight(0); focused.current = null; });
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  return {
    scroll,
    /** The keyboard's height now (0 when it is down): add it to the scroll content's bottom padding. */
    height,
    /** Give to each TextInput's onFocus. */
    reveal: (event: TextInputFocusEvent) => { focused.current = event.currentTarget as unknown as Measurable; adjust(); },
    /** Give to the ScrollView's onScroll (with scrollEventThrottle 16). */
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; },
    dismiss: () => Keyboard.dismiss()
  };
}
