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
//
// serifFamily is imported from a platform-forked module (serifFamily.ios/android.ts) rather
// than computed via `Platform.select` here: tokens.ts is imported by contrast.test.ts in the
// Node unit lane, and any static `import ... from 'react-native'` breaks that lane (rolldown
// cannot parse RN's Flow index.js). The forked module imports nothing from react-native — it
// just exports a string — so tokens.ts stays Node-importable while Metro still picks the right
// face per platform. See serifFamily.ts.
import { serifFamily } from './serifFamily.js';

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
  // The dim behind a modal sheet — a translucent wash over the canvas so the sheet reads as
  // lifted above the screen. NOT a text/figure surface (nothing readable sits ON the scrim
  // itself; the sheet is a normal surface drawn over it), so it is deliberately outside the
  // AA-graded families — it carries no contrast contract.
  readonly overlay: {
    readonly scrim: ColorValue;
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
  // Barely-rounded corners on garment cutout wells / grid thumbs — the clothes read as
  // photographed objects, not chips.
  readonly xs: number;
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
  // Optional style refinements. RN uses POINTS for letterSpacing (not em); textTransform
  // and fontStyle carry the overline (uppercase) and note (serif italic) variants. Existing
  // display/title/body/caption entries omit all three and compile unchanged.
  readonly letterSpacing?: number;
  readonly textTransform?: 'uppercase';
  readonly fontStyle?: 'italic';
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
  // The SERIF display face (the redesign's one structural type change). Platform-selected
  // because a bare 'Georgia' silently falls back to the default SANS on Android — the same
  // "absent typeface" bug the `family` comment above documents. iOS: Georgia; Android: the
  // generic 'serif' (Noto Serif, bundled, no dependency). Only `display` and `note` use it.
  readonly serifFamily: string;
  readonly weight: {
    readonly regular: TypographyWeight;
    readonly medium: TypographyWeight;
    readonly semibold: TypographyWeight;
  };
  // Clear hierarchy: display (the reveal moment / one per screen) → title → body → caption.
  // overline = tiny uppercase eyebrows + metadata keys; note = serif italic advisory line.
  readonly display: TypographyScaleEntry;
  readonly title: TypographyScaleEntry;
  readonly body: TypographyScaleEntry;
  readonly caption: TypographyScaleEntry;
  readonly overline: TypographyScaleEntry;
  readonly note: TypographyScaleEntry;
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
      // Warm cream paper, NOT near-white. The old #FBFAF9/#FFFFFF pair had ~1.06:1
      // figure/ground, so a card needed a hairline border to be seen at all — the flat
      // bordered-card look. A cream canvas gives white surfaces real lift, so the soft
      // shadow separates them and the border can drop (see Card). This is the defining
      // move of the warm-soft-depth direction (docs/research/design-soft.md).
      canvas: '#F6F2EC', // warm cream
      surface: '#FFFFFF', // white cards lift off the cream
      sunken: '#EDE6DB', // warm recessed tray so cutouts read as lifted
    },
    text: {
      primary: '#221F1B', // warm near-black (softer than pure black) — 13.24:1 on sunken
      secondary: '#655F58', // warm taupe-gray — 5.09:1 on sunken
      tertiary: '#6C655C', // warm gray hints/metadata — 4.64:1 on sunken
      onAccent: '#FFFFFF', // ≥5.9:1 on every accent.* fill
    },
    // Text/fill-legal accents. Re-hued slightly warmer + deepened so they clear AA on the
    // warmer, darker cream/sunken backgrounds (≥4.5 as text on every bg, ≥5.9 white-on-fill).
    accent: {
      pink: '#B62E58', // signature — 4.81:1 · white-on-it 5.96:1 · hue ~342°
      red: '#B33A2C', // rare emphasis — 4.76:1 · white-on-it 5.90:1 · hue ~7°
      blue: '#396595', // cool secondary — 4.88:1 · white-on-it 6.05:1 · hue ~209°
    },
    // Decoration ONLY (dots, rules, strip edges); deliberately below the text floor —
    // nothing readable ever touches them. Re-hued warmer to sit in the cream palette.
    accentDecorative: {
      pink: '#E0708F', // soft blush — the Today highlight-strip edge + spinner backdrop
      red: '#D45647',
      blue: '#5E8FC0',
    },
    border: {
      hairline: '#E4DCD0', // warm hairline; on the sunken tray + dividers (surface cards drop it)
    },
    // Warm brown-black at ~45% — dims the cream canvas behind a sheet without going cold-black.
    // rgba (not hex) because a scrim IS its alpha: the translucency is the whole point.
    overlay: {
      scrim: 'rgba(58, 46, 35, 0.45)',
    },
    // Availability dots. 3.0:1 non-text floor (always paired with a label — meaning is never
    // by hue alone). Nudged to sit in the warm neutral family; all clear 3.0 on sunken.
    state: {
      clean: '#4E8A6A', // 3.28:1 · calm positive · hue ~148°
      dirty: '#9A7A38', // 3.25:1 · muted, non-alarming ("in the wash") · hue ~42°
      unavailable: '#847E76', // 3.24:1 · neutral/dimmed
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
    // Larger radii are where "soft" lives — 18 on a standard card, 28 on the hero card
    // read pillowy and modern without tipping into toy-like.
    xs: 6, // garment cutout wells / grid thumbs — reads as a photo, not a chip
    sm: 12, // chips, small controls
    md: 18, // default card / button radius
    lg: 28, // hero cards, sheets, the Today card
    pill: 999,
  },
  shadow: {
    // One soft, warm, diffuse triple — RN gives us a single shadow, so it does all the work.
    // Warm brown-black (not neutral) on a cream canvas reads as soft daylight, not a hard
    // drop; wide blur (24) + low opacity (0.10) + a gentle downward offset reads as a surface
    // floating a few mm off the page. The old 0.06/12/y4 was the "barely-there" shadow.
    shadowColor: '#3A2E23',
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  typography: {
    // 'System' is React Native's cross-platform alias for the OS UI face — SF Pro on iOS,
    // Roboto on Android. Chosen deliberately over `undefined`: same rendering, but now the
    // typeface is a stated decision that a component reads, rather than an absence.
    family: 'System',
    // Platform-forked at the module boundary (serifFamily.ios/android.ts) so Android does not
    // silently fall back to sans. Georgia (iOS) / generic 'serif' = Noto Serif (Android) — both
    // bundled with the OS, no font file, no licensing question.
    serifFamily,
    weight: {
      regular: '400',
      medium: '500',
      semibold: '600',
    },
    // display is now SERIF at 28/34 (iOS Title-1 footprint). It was 34pt SANS; the redesign
    // mockups pushed a 34–40pt serif that read too large — a serif carries more optical weight
    // than the system sans at the same px, so 28pt serif ≈ the visual size of the old 34pt sans.
    // Used at most ONCE per screen. caption stays 400→500 so warm-gray metadata reads intentional.
    display: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.3 },
    title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
    body: { fontSize: 16, lineHeight: 25, fontWeight: '400' },
    caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
    // Tiny uppercase eyebrow / metadata key. 11pt = the iOS legibility floor (never smaller);
    // letterSpacing 2 ≈ 0.18em at 11px (RN uses points, not em). Defaults to tertiary tone in Text.
    overline: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 2, textTransform: 'uppercase' },
    // Serif italic advisory line (the "why this" note, privacy promise, untitled-look names).
    // family swap to serifFamily happens in Text, same as display.
    note: { fontSize: 16, lineHeight: 23, fontWeight: '400', fontStyle: 'italic' },
  },
};
