// Token-only entrance animation: content fades in while rising a few points, on mount.
// The app's one "things arrive, they don't just appear" gesture — the cheapest way to make
// a static screen read as composed/cinematic without a motion library.
//
// BUILT ON RN's CORE Animated ONLY (no Reanimated/Moti in this app): a single Animated.Value
// driving opacity + translateY, both on the NATIVE thread (useNativeDriver: true). Opacity and
// transform are the only two things the native driver animates, which is exactly why the effect
// is limited to those — animating height/width/margin would run on the JS thread and jank. The
// content's layout never changes; it only paints differently, so there is zero layout cost.
//
// Timings + curve come from tokens.motion (plain-data bezier turned into Easing.bezier here) so
// every animated surface in the app shares one hand. `delay` lets a parent stagger children
// (grid tiles, stacked sections) by tokens.motion.stagger * index.
//
// REDUCE MOTION IS RESPECTED: if the OS "Reduce Motion" switch is on, the content is rendered at
// its final opacity/position with no animation — an accessibility requirement (WCAG 2.3.3), not a
// nicety. The check is read once on mount via AccessibilityInfo.
import React from 'react';
import { Animated, Easing, AccessibilityInfo, type ViewStyle } from 'react-native';
import { useTokens } from '../tokens/index.js';

export interface EntranceProps {
  readonly children: React.ReactNode;
  // Stagger offset in ms (e.g. tokens.motion.stagger * index for a list). Default 0.
  readonly delay?: number;
  // How far the content rises as it fades in, in points. Default 8 — a subtle lift.
  readonly translateY?: number;
  readonly style?: ViewStyle;
}

export function Entrance({ children, delay = 0, translateY = 8, style }: EntranceProps): React.JSX.Element {
  const tokens = useTokens();
  // Starts hidden + slightly low; animates to 1 / 0. A ref so it survives re-renders and is
  // never recreated (a fresh Animated.Value each render would restart the animation).
  const progress = React.useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    // Read the OS setting once; if it's on, skip straight to the resting state.
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (cancelled) return;
      if (enabled) {
        setReduceMotion(true);
        progress.setValue(1);
        return;
      }
      Animated.timing(progress, {
        toValue: 1,
        duration: tokens.motion.duration.base,
        delay,
        easing: Easing.bezier(...tokens.motion.easing.standard),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: the entrance plays exactly once per mounted instance. `progress` is a stable
    // ref; `delay` and the motion tokens are fixed for the life of a mounted Entrance, so an
    // empty dependency list is correct (re-running would restart the animation mid-view).
  }, []);

  // When reduce-motion is on we still render through Animated.View (progress pinned at 1) so the
  // markup is identical either way — no branch that could drift.
  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: reduceMotion
          ? 0
          : progress.interpolate({ inputRange: [0, 1], outputRange: [translateY, 0] }),
      },
    ],
  };

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
