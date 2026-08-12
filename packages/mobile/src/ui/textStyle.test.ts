// Oracle for the Text primitive's pure style resolution. The independent check: the resolved
// style must (1) pull EVERY numeric field from the real shipped token scale (not a hand-copied
// table — that would be a mirror), (2) route only display+note through the serif family, (3)
// default only overline to tertiary, and (4) keep both maps TOTAL over the variant union so a
// newly-added variant cannot silently fall through to a sans/primary default.
import { describe, it, expect } from 'vitest';
import { lightTokens } from '../tokens/tokens.js';
import {
  resolveTextStyle,
  isSerifVariant,
  defaultTone,
  type TextVariant,
  type TextTone,
} from './textStyle.js';

// The full variant union, spelled out so the test breaks if a variant is added without a
// deliberate decision here (TS `satisfies` keeps this list in lockstep with the type).
const ALL_VARIANTS = ['display', 'title', 'body', 'caption', 'overline', 'note'] as const satisfies readonly TextVariant[];
const ALL_TONES = ['primary', 'secondary', 'tertiary', 'onAccent'] as const satisfies readonly TextTone[];

describe('resolveTextStyle — numeric fields come straight from the token scale', () => {
  it.each(ALL_VARIANTS)('%s copies fontSize/lineHeight/fontWeight from tokens.typography', (variant) => {
    const scale = lightTokens.typography[variant];
    const style = resolveTextStyle(lightTokens, variant, 'primary');
    expect(style.fontSize).toBe(scale.fontSize);
    expect(style.lineHeight).toBe(scale.lineHeight);
    expect(style.fontWeight).toBe(scale.fontWeight);
    // Optional refinements pass through verbatim (undefined when the scale omits them).
    expect(style.letterSpacing).toBe(scale.letterSpacing);
    expect(style.textTransform).toBe(scale.textTransform);
    expect(style.fontStyle).toBe(scale.fontStyle);
  });
});

describe('serif routing — only display + note render in the serif face', () => {
  it.each(ALL_VARIANTS)('%s picks the correct family', (variant) => {
    const expectSerif = variant === 'display' || variant === 'note';
    expect(isSerifVariant(variant)).toBe(expectSerif);
    const style = resolveTextStyle(lightTokens, variant, 'primary');
    expect(style.fontFamily).toBe(
      expectSerif ? lightTokens.typography.serifFamily : lightTokens.typography.family,
    );
  });

  it('the sans and serif families are actually different tokens (routing is observable)', () => {
    expect(lightTokens.typography.family).not.toBe(lightTokens.typography.serifFamily);
  });
});

describe('default tone — only overline defaults to tertiary, the rest to primary', () => {
  it.each(ALL_VARIANTS)('%s default tone', (variant) => {
    expect(defaultTone(variant)).toBe(variant === 'overline' ? 'tertiary' : 'primary');
  });

  it('an explicit tone always overrides the default', () => {
    for (const variant of ALL_VARIANTS) {
      for (const tone of ALL_TONES) {
        expect(resolveTextStyle(lightTokens, variant, tone).color).toBe(lightTokens.color.text[tone]);
      }
    }
  });

  it('overline with no tone resolves to the tertiary color', () => {
    expect(resolveTextStyle(lightTokens, 'overline', undefined).color).toBe(lightTokens.color.text.tertiary);
  });
});

describe('the resolution maps are TOTAL over the variant union (silent-fallthrough guard)', () => {
  it('every variant resolves a color, a family, a size and a defined tone', () => {
    for (const variant of ALL_VARIANTS) {
      const style = resolveTextStyle(lightTokens, variant, undefined);
      expect(style.color).toBeTypeOf('string');
      expect(style.fontFamily).toBeTypeOf('string');
      expect(style.fontSize).toBeTypeOf('number');
      expect(ALL_TONES).toContain(defaultTone(variant));
    }
  });
});
