# Atelier — the shared design brief (SSOT for the redesign)

The owner's verdict: the crafted (right) side of `docs/research/design-comparison.html` wins
decisively. **The problem was never the palette — it's the craft.** Every mockup in this wave
follows THIS brief so the screens are one coherent system, not six styles.

## The anti-slop laws (non-negotiable — these are what move it off "AI slop")

1. **The clothes are the interface.** Lead with the garment cutout, full-bleed or edge-to-edge.
   NEVER a category word ("top", "outerwear") where a photo belongs. No giant empty placeholder wells.
2. **Not everything is a card.** Mix modes: a full-bleed hero, an edge-to-edge grid, hairline
   dividers, bare sections. A rounded-card-with-shadow on every element is the demo look. Cards earn their place.
3. **Quiet, confident actions.** No full-width shouting pill as the primary CTA. Use an underlined
   uppercase label, or an icon button, or a restrained filled button used ONCE. Premium is restrained.
4. **Asymmetry + left-alignment.** Kill the dead-centered title/word/button stack. Real baseline
   grid, left-aligned headings, intentional off-center tension. Editorial, not PowerPoint.
5. **Type hierarchy with contrast.** A SERIF display headline (Georgia in-app, no dependency) +
   tiny uppercase overlines (11px, letterspaced) + restrained sans body. Size AND style contrast.
6. **Rhythm, not uniform padding.** Generous space around a hero, tight in a grid. Space is a tool.
7. **Nav: 5 tabs, not 7.** Today · Closet · Add · Outfits · You. (Plan folds into Today; Account
   lives under "You" — Account MUST stay reachable in-app for Apple Guideline 5.1.1(v).)

## The palette — KEEP the shipped warm-soft-depth tokens (do NOT abandon pink)

These are the values already in `packages/mobile/src/tokens/tokens.ts` and passing `contrast.test.ts`.
Use them verbatim; the redesign changes LAYOUT + HIERARCHY, not the theme.

- bg.canvas `#F6F2EC` (warm cream) · bg.surface `#FFFFFF` · bg.sunken `#EDE6DB`
- text.primary `#221F1B` · secondary `#655F58` · tertiary `#6C655C` · onAccent `#FFFFFF`
- accent.pink `#B62E58` (the signature — KEPT) · red `#B33A2C` · blue `#396595`
- accentDecorative.pink `#E0708F` · red `#D45647` · blue `#5E8FC0`
- border.hairline `#E4DCD0`
- state.clean `#4E8A6A` · dirty `#9A7A38` · unavailable `#847E76`
- radius sm 12 · md 18 · lg 28 · pill 999 · shadow #3A2E23 / 0.10 / r24 / y8

## Type system (the ONE structural token change this redesign introduces)

- **display → SERIF** (Georgia, bundled with the OS, no dependency), **28/34** semibold, tight
  leading, -0.01em. Used at most ONCE per screen. NOTE: the mockups rendered this at 34–40px and
  read too large; 28pt serif ≈ the visual size of the 34pt sans already shipping (iOS Title-1
  footprint). See ATELIER-SYNTHESIS.md §1d for the sizing rationale.
- **title** → sans 22/28 semibold.
- **body** → sans 16/25 regular.
- **caption** → sans 13/18.
- **overline (NEW)** → sans 11/16, `letter-spacing: 0.18em`, uppercase, tertiary color. Used for
  section eyebrows and metadata keys. (11pt = the iOS legibility floor — never smaller.)
- Accent used as a *punctuation* (a rule under an action, a state dot), never a large fill.

## HTML mockup conventions (so the critic can compare them)

- One file per screen: `docs/research/design/screen-<name>.html`, a single 340px iPhone frame.
- Inline `<style>` only; use the exact hex values above as CSS vars. Serif display via a Google
  Fonts `Fraunces` link (in-app maps to Georgia) so the serif idea is visible.
- Garments are SVG silhouettes filled with realistic fabric colors (camel #8a6f52, black #2b2b2f,
  ivory #e7e3dc, rose #9c5661) — stand-ins for the real cutout PNGs.
- Include the 5-tab bar (active tab uses accent.pink or an underline, per screen).
- At the bottom of each file, a `<!-- NOTES -->` comment block: which anti-slop laws this screen
  applies, and any token/primitive addition it assumes beyond the brief.

## Reference

`docs/research/design-comparison.html` — the crafted Today + Closet the owner approved. Match that
level of craft. `docs/research/design-editorial.md` and `design-soft.md` — prior spec detail
(palette already decided; take composition ideas, ignore the pink-abandon proposal).
