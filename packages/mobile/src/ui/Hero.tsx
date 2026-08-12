// A full-bleed hero band (brief law 1: the clothes ARE the interface). The garment fills the
// frame; an overline eyebrow sits top-left, an optional status slot top-right, and the display
// title + caption subtitle sit bottom-left.
//
// TWO CONTRAST REGIMES, chosen by whether a background IMAGE is present:
//   • WITH a background image — a bottom-up scrim darkens the lower band and the text is white
//     (onAccent). The scrim guarantees contrast over an unknown photo; onAccent is intentionally
//     outside the bg-graded contrast set for exactly this over-image use.
//   • WITHOUT a background image (the awaiting-cutout state, and the harness where cutouts aren't
//     signed) — NO scrim, and the text is dark (primary/secondary) on the sunken well. Painting a
//     half-height scrim over an empty cream well just produces an arbitrary grey rectangle, and
//     white text on it is marginal; dark-on-cream reads cleanly and needs no scrim. The cutout
//     (or a caller-supplied silhouette in `children`) still fills the frame — never a category word.
//
// Dependency-free: RN core ImageBackground + a solid scrim View, NOT a gradient library (no
// expo-linear-gradient in the bundle, and adding a dep is not this wave's call).
import React from 'react';
import { View, ImageBackground, type ImageSourcePropType } from 'react-native';
import { useTokens } from '../tokens/index.js';
import { Text } from './Text.js';

export interface HeroProps {
  readonly height: number;
  readonly title: string;
  readonly eyebrow?: string;
  readonly subtitle?: string;
  readonly background?: ImageSourcePropType;
  // Top-right status (e.g. a "Ready to wear" dot+label).
  readonly statusSlot?: React.ReactNode;
  // The garment cutout, centred in the frame.
  readonly children?: React.ReactNode;
}

export function Hero({
  height,
  title,
  eyebrow,
  subtitle,
  background,
  statusSlot,
  children,
}: HeroProps): React.JSX.Element {
  const tokens = useTokens();
  const hasImage = background !== undefined;
  // Text tone follows the contrast regime: white over the scrimmed image, dark on the bare well.
  const titleTone = hasImage ? 'onAccent' : 'primary';
  const supportTone = hasImage ? 'onAccent' : 'secondary';

  const frame = (
    <View style={{ flex: 1 }}>
      {/* the garment cutout, centred */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{children}</View>

      {/* bottom-up scrim ONLY when there is an image to darken (see the two-regime note above) */}
      {hasImage ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.round(height * 0.5),
            backgroundColor: tokens.color.overlay.scrim,
          }}
        />
      ) : null}

      {/* eyebrow top-left */}
      {eyebrow !== undefined ? (
        <View style={{ position: 'absolute', top: tokens.spacing.xl, left: tokens.spacing.xl }}>
          <Text variant="overline" tone={hasImage ? 'onAccent' : 'tertiary'}>
            {eyebrow}
          </Text>
        </View>
      ) : null}

      {/* status top-right */}
      {statusSlot !== undefined ? (
        <View style={{ position: 'absolute', top: tokens.spacing.xl, right: tokens.spacing.xl }}>
          {statusSlot}
        </View>
      ) : null}

      {/* title + subtitle bottom-left */}
      <View
        style={{
          position: 'absolute',
          left: tokens.spacing.xl,
          right: tokens.spacing.xl,
          bottom: tokens.spacing.xl,
          gap: tokens.spacing.xs,
        }}
      >
        <Text variant="display" tone={titleTone}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="caption" tone={supportTone}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (background !== undefined) {
    return (
      <ImageBackground source={background} style={{ height }} resizeMode="cover">
        {frame}
      </ImageBackground>
    );
  }
  return <View style={{ height, backgroundColor: tokens.color.bg.sunken }}>{frame}</View>;
}
