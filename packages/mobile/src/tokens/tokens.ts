// The design-token SSOT for the mobile app. This is the ONE place colors, spacing,
// radius, and typography live — components read them via useTokens() and NEVER
// write literal hex/px (a CI gate enforces the no-literal-color rule).
//
// IMPORTANT — these are INTENT-LEVEL placeholders per docs/03-design-system.md:
// light theme, near-white warm canvas, pink/red/blue accents used as sparing
// HIGHLIGHTS (never large fills), soft radius + shadow, one 4px spacing scale
// (4/8/12/16/24/32/48). The EXACT hex values, the chosen typeface, and precise
// radii/shadow are finalized with mockups (docs/03 "Open") and slot in HERE
// without any structural change: the shape of the token object is the contract,
// the values are provisional. Do not scatter these values into components.

// A hex string. Kept as a nominal-ish alias so the intent ("this is a token
// value, defined only in this file") reads at the call site.
export type ColorValue = string;

export interface ColorTokens {
  readonly bg: {
    // App background — near-white, warm (docs/03 "bg.canvas").
    readonly canvas: ColorValue;
    // Cards, sheets — white / faintest tint (docs/03 "bg.surface").
    readonly surface: ColorValue;
    // Wells + cutout backdrops — soft neutral so garment cutouts pop off the page.
    readonly sunken: ColorValue;
  };
  readonly text: {
    // Headings, item names — near-black, high contrast (WCAG AA).
    readonly primary: ColorValue;
    // Supporting copy — warm gray.
    readonly secondary: ColorValue;
    // Hints, metadata — lighter gray.
    readonly tertiary: ColorValue;
    // Text drawn on top of an accent fill (e.g. a filled Button).
    readonly onAccent: ColorValue;
  };
  readonly accent: {
    // The signature warm highlight; the primary accent.
    readonly pink: ColorValue;
    // Emphasis / occasional CTA — used rarely, deliberate.
    readonly red: ColorValue;
    // Cool highlight / secondary — balances the warm accents.
    readonly blue: ColorValue;
  };
  readonly border: {
    // Dividers, card edges — barely-there.
    readonly hairline: ColorValue;
  };
  // Availability states. NEVER encode meaning in hue alone (docs/03 accessibility):
  // these pair with an icon + label at the call site. Laundry is normal, not an
  // error — `dirty` is muted, non-alarming.
  readonly state: {
    readonly clean: ColorValue;
    readonly dirty: ColorValue;
    readonly unavailable: ColorValue;
  };
}

// One spacing scale (docs/03 §"Spacing & layout"): 4px base, 4/8/12/16/24/32/48.
// Named by role-agnostic step so layouts compose from the scale, never ad-hoc px.
export interface SpacingTokens {
  readonly xs: number; // 4
  readonly sm: number; // 8
  readonly md: number; // 12
  readonly lg: number; // 16
  readonly xl: number; // 24
  readonly xxl: number; // 32
  readonly xxxl: number; // 48
}

// Soft, consistent radii (docs/03: rounded corners on cards/sheets).
export interface RadiusTokens {
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  // Fully round (chips, avatars) — a large constant, not a computed 50%.
  readonly pill: number;
}

// Soft elevation, never harsh. A single provisional shadow the ui primitives spread
// onto a View's style; the exact blur/opacity is finalized with mockups.
export interface ShadowToken {
  readonly shadowColor: ColorValue;
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  // Android elevation companion to the iOS shadow triple.
  readonly elevation: number;
}

export interface TypographyScaleEntry {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: TypographyWeight;
}

export type TypographyWeight = '400' | '500' | '600';

export interface TypographyTokens {
  // One family, small weight range (docs/03). `undefined` = the platform default
  // sans until the exact humanist/geometric face is chosen with mockups; it slots
  // in here without touching a single component.
  readonly family: string | undefined;
  readonly weight: {
    readonly regular: TypographyWeight;
    readonly medium: TypographyWeight;
    readonly semibold: TypographyWeight;
  };
  // Clear hierarchy: display (the reveal moment) → title → body → caption.
  readonly display: TypographyScaleEntry;
  readonly title: TypographyScaleEntry;
  readonly body: TypographyScaleEntry;
  readonly caption: TypographyScaleEntry;
}

export interface Tokens {
  readonly color: ColorTokens;
  readonly spacing: SpacingTokens;
  readonly radius: RadiusTokens;
  readonly shadow: ShadowToken;
  readonly typography: TypographyTokens;
}

// ---------------------------------------------------------------------------
// The light theme — the only theme in MVP (docs/03: "Light theme"). A dark theme,
// if it ever exists, is a second Tokens object selected by the provider; the token
// SHAPE above does not change. Values are provisional placeholders, see file header.
// ---------------------------------------------------------------------------
export const lightTokens: Tokens = {
  color: {
    bg: {
      canvas: '#FBFAF9', // near-white, faint warm
      surface: '#FFFFFF',
      sunken: '#F3F1EF', // soft neutral well for cutouts
    },
    text: {
      primary: '#1A1A1A',
      secondary: '#5C5A57',
      tertiary: '#9A9793',
      onAccent: '#FFFFFF',
    },
    accent: {
      pink: '#E8709A', // signature warm highlight
      red: '#D8483F', // rare, deliberate emphasis
      blue: '#5A8FC7', // cool secondary highlight
    },
    border: {
      hairline: '#E7E4E1',
    },
    state: {
      clean: '#6FA98A', // calm positive
      dirty: '#C9A96A', // muted, non-alarming ("in the wash")
      unavailable: '#B7B4B0', // neutral/dimmed
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 20,
    pill: 999,
  },
  shadow: {
    shadowColor: '#1A1A1A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  typography: {
    family: undefined,
    weight: {
      regular: '400',
      medium: '500',
      semibold: '600',
    },
    display: { fontSize: 32, lineHeight: 40, fontWeight: '600' },
    title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
    body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  },
};
