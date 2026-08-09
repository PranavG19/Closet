// Today's suggestion card (F5). The daily loop's heuristic runs ON-DEVICE over the user's
// own wardrobe (docs/06: zero server endpoint).
//
// THE HEURISTIC IS NOW ACTUALLY WIRED. This screen previously rendered `items[0]` — the
// first row the server happened to return — under the hardcoded sentence "This pairs
// beautifully with your neutrals.", which was printed for every outfit including ones with
// no neutral in them. Meanwhile suggestItems() and harmony() sat fully built and tested in
// @closet/shared with ZERO callers. Now the outfit is what the heuristic selects and the
// note is derived from the real harmony verdict of the garments chosen.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { suggestItems, toSuggestionItems, suggestionNote } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe, useLogWear } from '../../src/api/index.js';
import { Screen, Card, Text, Button, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';

// Weather is a ROADMAP feature — there is no WeatherPort implementation and no server seam
// for it (docs/06 §9 records the deliberate absence). suggestItems requires a temperature,
// so this is a fixed mild default, named rather than inlined so it is obvious this is a
// placeholder and not a measured value. Its only effect is the target layer count; the
// selection is still real, and every warmth ordering and monotonicity property holds.
const ASSUMED_TEMP_C = 18;

// client_id is minted by the CALLER at tap time (idempotency). uuid via the RN
// crypto global; a retry of the same tap reuses this id so the wear row dedups.
function mintClientId(): string {
  return (globalThis.crypto as { randomUUID(): string }).randomUUID();
}

export function SuggestionsScreen(): React.JSX.Element {
  const tokens = useTokens();
  // DELIBERATELY UNFILTERED. This used to request `availability: 'clean'`, which made the
  // two fallback cases indistinguishable — a filtered-empty response looks identical whether
  // she owns nothing or owns forty garments that are all in the wash, and those need
  // opposite advice. suggestItems applies the wearability filter itself (unconditionally,
  // first, with no later branch re-admitting an excluded item), so fetching everything moves
  // no trust and lets the empty state tell the truth.
  const query = useWardrobe({});
  const logWear = useLogWear();

  if (query.isPending) return <LoadingState message="Putting together today's look…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't build a suggestion." onRetry={() => void query.refetch()} />;
  }

  // THE REAL HEURISTIC. It filters to wearable garments itself and is total — it always
  // returns either a wearable set or an explicit fallback, so there is no undefined case to
  // guard beyond the fallback branch.
  const rows = query.data.items;
  const suggestion = suggestItems({ items: toSuggestionItems(rows), tempC: ASSUMED_TEMP_C });

  if (suggestion.fallback) {
    // The heuristic's own reason distinguishes "closet is empty" from "everything is in the
    // wash" — two situations with completely different next actions for her. The previous
    // code collapsed both into "add a few pieces", which is unhelpful advice to someone who
    // owns forty garments and needs to do laundry.
    const nothingOwned = rows.length === 0;
    return (
      <EmptyState
        title={nothingOwned ? 'Nothing to suggest yet' : 'Everything is in the wash'}
        body={
          nothingOwned
            ? "Add a few pieces and we'll style today's look for you."
            : 'Mark something clean in Laundry and today’s look will appear here.'
        }
      />
    );
  }

  // The heuristic returns warmest-first, so the first selected garment is the anchor of the
  // look. Re-read the full row for display: the heuristic's item view carries only what it
  // needs to decide (id/status/warmth/category), not the colour or cutout the card renders.
  const heroItem = suggestion.items[0]!;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const hero = byId.get(heroItem.id)!;
  const selectedRows = suggestion.items.flatMap((selected) => {
    const row = byId.get(selected.id);
    return row === undefined ? [] : [row];
  });
  // Null when there is nothing honest to say — a single-colour outfit, unknown colours, or a
  // clash (which the product deliberately never scolds). The card omits the strip entirely
  // rather than printing filler.
  const note = suggestionNote(selectedRows);

  // Gentle highlight strip — advisory, never a red error/nag (docs/03).
  const highlight: ViewStyle = {
    borderLeftWidth: 3,
    borderLeftColor: tokens.color.accentDecorative.pink,
    paddingLeft: tokens.spacing.md,
    marginTop: tokens.spacing.md,
  };
  const heroWell: ViewStyle = {
    aspectRatio: 1,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.spacing.md,
  };

  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.lg }}>
        Today
      </Text>
      <Card variant="surface" padding="lg">
        <View style={heroWell} accessibilityLabel={`Suggested ${hero.category}`}>
          <Text variant="caption" tone="tertiary">
            {hero.category}
          </Text>
        </View>
        <Text variant="title" tone="primary">
          {hero.color ?? hero.category}
        </Text>
        {/* The rest of the look the heuristic picked. Previously invisible: the screen
            showed one garment and said nothing about what it was suggested WITH. */}
        {selectedRows.length > 1 && (
          <Text variant="body" tone="secondary" style={{ marginTop: tokens.spacing.xs }}>
            {`with ${selectedRows
              .slice(1)
              .map((row) => row.color ?? row.category)
              .join(', ')}`}
          </Text>
        )}
        {note !== null && (
          <View style={highlight}>
            <Text variant="body" tone="secondary">
              {note}
            </Text>
          </View>
        )}
        <Button
          label={logWear.isPending ? 'Logging…' : 'I wore this'}
          disabled={logWear.isPending}
          onPress={() => logWear.mutate({ item_id: hero.id, client_id: mintClientId() })}
          style={{ marginTop: tokens.spacing.lg }}
        />
      </Card>
    </Screen>
  );
}
