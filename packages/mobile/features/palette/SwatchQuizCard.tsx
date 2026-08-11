// B1 — the self-identified swatch quiz (docs/01 §B1), rendered as an embeddable card.
//
// THE DEFINING CONSTRAINT (app invariant): skin tone / palette is SELF-IDENTIFIED — she
// taps the colours she feels flattering — NEVER camera-detected, and the result is
// ADVISORY, never prescriptive. There is deliberately no photo input and no "your season
// is…" verdict: the card only records what she chose. Copy says so plainly.
//
// It is an embeddable Card (not a full Screen) because the flat tab shell has no free slot
// and no push navigation yet (features/navigation/tabs.ts). It sits inside the Account
// screen's ScrollView. The pure selection→hues logic lives in @closet/shared/swatchQuiz
// (unit-tested); this file is the tap surface and the save call.
import React from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';
import {
  SWATCH_FAMILIES,
  paletteFromSwatches,
  isCompletePalette,
  familySwatchHex,
  isColorFamily,
  type ColorFamily,
} from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { Card, Text, Button } from '../../src/ui/index.js';
import { useUpsertPalette } from '../../src/api/index.js';

// A single tappable swatch. Its fill is the family's own representative colour (derived from
// the colour wheel in @closet/shared, not a literal), so the swatch cannot drift from the
// family the palette scorer will match. Selection is a ring, not a fill change, so the
// swatch colour she is judging never changes under her.
function Swatch({
  family,
  selected,
  onToggle,
}: {
  readonly family: ColorFamily;
  readonly selected: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const size = tokens.spacing.xl * 2;
  const style: ViewStyle = {
    width: size,
    height: size,
    borderRadius: tokens.radius.md,
    backgroundColor: familySwatchHex(family),
    borderWidth: selected ? 3 : 1,
    borderColor: selected ? tokens.color.accent.pink : tokens.color.border.hairline,
    margin: tokens.spacing.xs,
  };
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${family}${selected ? ', selected' : ''}`}
      style={style}
    />
  );
}

export function SwatchQuizCard(): React.JSX.Element {
  const tokens = useTokens();
  const upsert = useUpsertPalette();
  const [selected, setSelected] = React.useState<ReadonlySet<ColorFamily>>(new Set());

  const toggle = (family: ColorFamily): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(family)) next.add(family);
      return next;
    });
  };

  const result = paletteFromSwatches([...selected]);
  const canSave = isCompletePalette(result) && !upsert.isPending;

  const onSave = (): void => {
    upsert.mutate({ hues: [...result.hues] });
  };

  const grid: ViewStyle = {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    marginTop: tokens.spacing.md,
  };

  return (
    <Card padding="lg" style={{ gap: tokens.spacing.sm, marginBottom: tokens.spacing.xl }}>
      <Text variant="title" tone="primary">
        Your colours{'  '}
        <Text variant="caption" tone="tertiary">
          beta
        </Text>
      </Text>
      <Text variant="body" tone="secondary">
        Tap the colours you feel good in. We use them only to gently favour pieces in your
        palette when two options are otherwise equal — it’s self-chosen, never taken from a
        photo, and never a rule.
      </Text>

      <View style={grid}>
        {SWATCH_FAMILIES.filter(isColorFamily).map((family) => (
          <Swatch key={family} family={family} selected={selected.has(family)} onToggle={() => toggle(family)} />
        ))}
      </View>

      <Button
        label={upsert.isPending ? 'Saving…' : `Save my colours${result.hues.length > 0 ? ` (${result.hues.length})` : ''}`}
        accent="pink"
        disabled={!canSave}
        onPress={onSave}
        style={{ marginTop: tokens.spacing.md }}
      />

      {upsert.isSuccess && (
        <Text variant="caption" tone="secondary" style={{ marginTop: tokens.spacing.sm }}>
          Saved — we’ll lean toward these when styling your looks.
        </Text>
      )}
      {upsert.isError && (
        <Text variant="caption" tone="secondary" style={{ marginTop: tokens.spacing.sm }}>
          We couldn’t save your colours just now. Please try again.
        </Text>
      )}
    </Card>
  );
}
