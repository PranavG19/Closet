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
    // Hints, metadata — the LIGHTEST tone that still clears AA 4.5:1 on every bg.
    // It is not "as light as looks nice": at #9A9793 it measured 2.58:1, failing even
    // the 3.0 large-text floor, which made every hint and every timestamp unreadable
    // for anyone with low vision.
    readonly tertiary: ColorValue;
    // Text drawn on top of an accent FILL (e.g. a filled Button). Only ever legal on
    // `accent.*` — never on `accentDecorative.*`, which is too light to carry a label.
    readonly onAccent: ColorValue;
  };
  // ACCENTS SPLIT BY ROLE, and the split is the whole accessibility fix.
  //
  // One accent cannot be both the brightest possible brand pink AND legible as text —
  // those are contradictory constraints, and collapsing them is why 7 of 10 foreground
  // tokens failed AA. So there are two families:
  //   `accent.*`            — legal as TEXT and as a FILL under a white label. AA 4.5:1
  //                           against every bg, and ≥4.5:1 for white-on-it.
  //   `accentDecorative.*`  — the brighter brand tones, legal ONLY where no text touches
  //                           them: a dot, a rule, a border, a highlight strip edge.
  // Both preserve the exact hue of the original brand values (339° pink, 4° red, 211°
  // blue); only lightness moved. The aesthetic is unchanged, the contrast is not.
  readonly accent: {
    // The signature warm highlight; the primary accent.
    readonly pink: ColorValue;
    // Emphasis / occasional CTA — used rarely, deliberate.
    readonly red: ColorValue;
    // Cool highlight / secondary — balances the warm accents.
    readonly blue: ColorValue;
  };
  // Decoration ONLY. Putting text on these, or a white label on a fill of these, is the
  // AA failure this family exists to keep out of the text tokens.
  readonly accentDecorative: {
    readonly pink: ColorValue;
    readonly red: ColorValue;
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
  // One family, small weight range (docs/03 §Typography: "a modern humanist/geometric
  // sans; one family").
  //
  // NO LONGER `string | undefined`. It was optional, it was set to `undefined`, and
  // `Text.tsx` spread `fontFamily` in conditionally — so the app shipped with NO typeface
  // set at all and nothing failed. That is the structural cause of "the fonts are messed
  // up": not a wrong font, an ABSENT decision. Making the field required means a build
  // cannot silently have no typeface again.
  //
  // The value is the platform's own humanist sans (San Francisco on iOS, Roboto on
  // Android), named EXPLICITLY rather than left to the default. That is a real choice, not
  // a placeholder: both are modern humanist sans faces that match what docs/03 asks for,
  // they need no font file in the bundle, they carry no licensing question, and they render
  // at the OS's optical sizes with correct Dynamic Type behaviour. Shipping a custom face
  // is a licensing + bundle-size decision the owner has to make; this is the honest default
  // in the meantime, and swapping it is a one-line change here.
  readonly family: string;
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
      primary: '#1A1A1A', // 15.45:1 worst-bg
      secondary: '#5C5A57', // 6.10:1
      // Was #9A9793 = 2.58:1, failing even the 3.0 floor. Same hue family, dark enough
      // to read: 4.62:1.
      tertiary: '#706C68',
      onAccent: '#FFFFFF', // ≥5.19:1 on every accent.* fill (was 2.91:1 on the old pink)
    },
    // Text/fill-legal accents. Hue identical to the brand tones below; lightness reduced
    // until both AA tests pass (≥4.61:1 on every bg, ≥5.19:1 for a white label on the fill).
    accent: {
      pink: '#CF215E', // 4.62:1 · white-on-it 5.21:1 · hue 339° (unchanged)
      red: '#CB3329', // 4.61:1 · white-on-it 5.19:1 · hue 4° (unchanged)
      blue: '#396FA9', // 4.64:1 · white-on-it 5.22:1 · hue 211° (unchanged)
    },
    // The original brand values, preserved for decoration where nothing must be read
    // against them. These are the hexes docs/03 specified; they are still the product's
    // colour, just no longer asked to do a job they cannot do.
    accentDecorative: {
      pink: '#E8709A', // signature warm highlight — dots, rules, strip edges
      red: '#D8483F',
      blue: '#5A8FC7',
    },
    border: {
      hairline: '#E7E4E1', // decorative hairline; carries no text
    },
    // Availability dots. The AA bar here is 3.0:1 (non-text UI indicator), not 4.5 — these
    // are always paired with a text label, so the colour is redundant reinforcement rather
    // than the sole carrier of meaning. Every one of them was under 2.5:1 before.
    state: {
      clean: '#589474', // 3.16:1 · calm positive · hue 148° (unchanged)
      dirty: '#A6823C', // 3.17:1 · muted, non-alarming ("in the wash") · hue 40°
      unavailable: '#8C8781', // 3.16:1 · neutral/dimmed
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
    // 'System' is React Native's cross-platform alias for the OS UI face — SF Pro on iOS,
    // Roboto on Android. Chosen deliberately over `undefined`: same rendering, but now the
    // typeface is a stated decision that a component reads, rather than an absence.
    family: 'System',
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
