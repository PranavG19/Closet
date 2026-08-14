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
import { View, Image, type ImageStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { suggestItems, toSuggestionItems, suggestionNote, outfitVerdict, suggestionRationale } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe, useLogWear, usePalette, useRecentWears } from '../../src/api/index.js';
import { useCutoutUris } from '../../src/storage/index.js';
import { useScreenLoad } from '../../src/metrics/index.js';
import { Screen, Hero, Text, Button, Divider, Entrance, LoadingState, EmptyState, ErrorState } from '../../src/ui/index.js';

// Weather is a ROADMAP feature — there is no WeatherPort implementation and no server seam
// for it (docs/06 §9 records the deliberate absence). suggestItems requires a temperature,
// so this is a fixed mild default, named rather than inlined so it is obvious this is a
// placeholder and not a measured value. Its only effect is the target layer count; the
// selection is still real, and every warmth ordering and monotonicity property holds.
const ASSUMED_TEMP_C = 18;

// client_id is minted by the CALLER at tap time (idempotency); a retry of the same tap reuses
// this id so the wear row dedups. Uses expo-crypto, NOT `globalThis.crypto.randomUUID()` — the
// RN/Hermes runtime has no global `crypto`, so the global form throws at tap time (proven on the
// simulator via the outfit-builder save, which had the identical bug). expo-crypto is already a
// declared dependency used for the Apple-auth nonce.
function mintClientId(): string {
  return Crypto.randomUUID();
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
  // Her self-identified palette (B1). Absent → { hues: [] }, so no colour signal. Its
  // loading/error is NOT gated on: the suggestion runs immediately without a palette and
  // gains the tie-break once the read arrives, rather than blocking today's look on it.
  const palette = usePalette();
  // Recent wears (F5 freshness). Advisory, like the palette: NOT gated on — the suggestion runs
  // immediately without it and gains the "don't re-pick yesterday's pieces" tie-break once the
  // read lands, rather than blocking today's look on a wear-log fetch.
  const recentWears = useRecentWears();
  // Signed cutout URLs for the wardrobe rows, keyed by item id — the hero renders the suggested
  // garment's real cutout when its URL has been signed. NOT gated on (same as WardrobeScreen):
  // the hero shows its empty well until the URL arrives. Declared before any early return so the
  // hook order is stable (Rules of Hooks); it reads the rows from the query once resolved.
  const cutouts = useCutoutUris(query.data?.items ?? []);
  // "Why this?" disclosure toggle. Declared with the other hooks, before any early return,
  // so the hook order is stable regardless of loading/fallback branches (Rules of Hooks).
  const [showWhy, setShowWhy] = React.useState(false);
  // True while the sequential wear-log loop is in flight. Local (not logWear.isPending) because
  // logWear's single-slot pending state only reflects the last call in a multi-row loop, so it
  // would flicker and clear between items. Declared before any early return (Rules of Hooks).
  const [loggingWear, setLoggingWear] = React.useState(false);
  // Mount → first-ready metric. Ready = wardrobe query resolved (the suggestion is computed
  // on-device from it; the palette read is advisory and not gated on). Unconditional, before
  // any early return, so the hook order is stable (Rules of Hooks).
  useScreenLoad('today', query.isSuccess);

  if (query.isPending) return <LoadingState message="Putting together today's look…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't build a suggestion." onRetry={() => void query.refetch()} />;
  }

  // THE REAL HEURISTIC. It filters to wearable garments itself and is total — it always
  // returns either a wearable set or an explicit fallback, so there is no undefined case to
  // guard beyond the fallback branch.
  const rows = query.data.items;
  // Her palette families, if the read has landed (advisory, may be empty). Passed to the
  // heuristic as the WITHIN-TIER tie-break: among equally-warm clean garments, an in-palette
  // one is preferred — never across warmth tiers, so the weather guarantee is untouched.
  const paletteFamilies = palette.data?.hues ?? [];
  const hasPalette = paletteFamilies.length > 0;
  // Item ids worn recently (advisory freshness signal; empty until the read lands). Deduped —
  // an item worn several times in the window need appear only once.
  const recentlyWornIds = [...new Set((recentWears.data?.entries ?? []).map((entry) => entry.item_id))];
  const suggestion = suggestItems({
    items: toSuggestionItems(rows),
    tempC: ASSUMED_TEMP_C,
    ...(hasPalette ? { paletteFamilies } : {}),
    ...(recentlyWornIds.length > 0 ? { recentlyWornIds } : {}),
  });

  if (suggestion.fallback) {
    // The heuristic's own reason distinguishes "closet is empty" from "everything is in the
    // wash" — two situations with completely different next actions for her. The previous
    // code collapsed both into "add a few pieces", which is unhelpful advice to someone who
    // owns forty garments and needs to do laundry.
    const nothingOwned = rows.length === 0;
    return (
      <EmptyState
        title={nothingOwned ? "Let's build your first look" : 'Everything is in the wash'}
        body={
          nothingOwned
            ? "Add a few pieces and we'll style today's look for you."
            : 'Mark something clean in your closet and today’s look will appear here.'
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

  // The fuller "why we suggested this" explanation (D-003 Step 4/5). Derived from the SAME
  // verdict the note uses (outfitVerdict), so the one-liner and the explanation cannot
  // disagree. hasPalette is now REAL (her B1 palette read); paletteInfluencedOrder is true
  // only when the tie-break actually changed the selection — recomputed by running the
  // heuristic WITHOUT the palette and comparing the chosen ids, so the rationale never
  // claims the palette steered a pick it didn't.
  //
  // Computed ONLY while the panel is open. The two influence checks each re-run suggestItems
  // over the whole closet purely to attribute the "Why this?" copy — work that is discarded on
  // every render where showWhy is false (the default). Gating it here keeps the default render
  // to the single primary suggestItems call above instead of three.
  const chosenIds = suggestion.items.map((i) => i.id).join(',');
  const rationale = showWhy
    ? suggestionRationale({
        selectedCount: selectedRows.length,
        verdict: outfitVerdict(selectedRows),
        hasPalette,
        // paletteInfluencedOrder: true only when the tie-break actually changed the selection —
        // re-run the heuristic WITHOUT the palette and compare the chosen ids.
        paletteInfluencedOrder: ((): boolean => {
          if (!hasPalette) return false;
          const withoutPalette = suggestItems({ items: toSuggestionItems(rows), tempC: ASSUMED_TEMP_C });
          if (withoutPalette.fallback) return false;
          return withoutPalette.items.map((i) => i.id).join(',') !== chosenIds;
        })(),
        // freshnessInfluencedOrder: true only when dropping recentlyWornIds changes the pick —
        // same honest re-run-and-compare, against the palette-aware selection (freshness ranks
        // below palette), so this isolates freshness's own contribution.
        freshnessInfluencedOrder: ((): boolean => {
          if (recentlyWornIds.length === 0) return false;
          const withoutFreshness = suggestItems({
            items: toSuggestionItems(rows),
            tempC: ASSUMED_TEMP_C,
            ...(hasPalette ? { paletteFamilies } : {}),
          });
          if (withoutFreshness.fallback) return false;
          return withoutFreshness.items.map((i) => i.id).join(',') !== chosenIds;
        })(),
      })
    : [];

  // The rest of the look, as a subtitle under the hero title ("with black denim & boots").
  const withLine =
    selectedRows.length > 1
      ? `with ${selectedRows
          .slice(1)
          .map((row) => row.color ?? row.category)
          .join(', ')}`
      : undefined;

  // Log every piece of the look, sequentially, each with its own client_id (see the button
  // comment for why sequential + distinct ids). mutateAsync so the loop awaits each write; a
  // failure stops the run (the wardrobe/recent-wears invalidation already reflects whatever
  // succeeded, and there is no batch to roll back).
  const logWholeLook = async (): Promise<void> => {
    setLoggingWear(true);
    try {
      for (const row of selectedRows) {
        await logWear.mutateAsync({ item_id: row.id, client_id: mintClientId() });
      }
    } catch {
      // The mutation's own error state is not surfaced as copy here (raw errors can carry PII,
      // per the app-wide rule); the wear either logged or it didn't, and the daily loop is
      // advisory. Swallow rather than alarm.
    } finally {
      setLoggingWear(false);
    }
  };

  // The suggested garment's real cutout, once its URL is signed. Falls back to the Hero's own
  // empty well (a sunken band) when absent — never a category word over the hero.
  const heroUri = cutouts.data?.[hero.id];
  const heroCutout: ImageStyle = { width: '70%', height: '70%', resizeMode: 'contain' };
  // The look's title: the garment's colour+category as an editorial line ("Camel outerwear").
  const heroTitle = hero.color !== null ? `${hero.color} ${hero.category}` : hero.category;

  return (
    <Screen scroll padding="none">
      {/* THE REVEAL is the app's one earned cinematic beat (tokens.motion "slow"): the hero
          arrives with a fade+rise rather than hard-cutting in. The body settles a stagger-beat
          later, so the day's look composes itself top-down. Entrance is native-driver + reduce-
          motion-aware, so this is free on the main thread and disabled for that a11y setting. */}
      <Entrance translateY={tokens.spacing.lg}>
        {/* The garment fills a full-bleed hero, its name in serif over a scrim. */}
        <Hero
          height={452}
          eyebrow="Today"
          title={heroTitle}
          {...(withLine !== undefined ? { subtitle: withLine } : {})}
        >
          {heroUri !== undefined ? (
            <Image source={{ uri: heroUri }} style={heroCutout} accessible={false} />
          ) : (
            // Awaiting its cutout: a quiet branded hanger glyph, never a category word (brief law 1).
            <Ionicons name="shirt-outline" size={72} color={tokens.color.text.tertiary} accessible={false} />
          )}
        </Hero>
      </Entrance>

      {/* The body floats on the canvas, divided by a hairline — not boxed in a card (law 2). */}
      <Entrance delay={tokens.motion.stagger} style={{ paddingHorizontal: tokens.spacing.xl, paddingTop: tokens.spacing.lg, gap: tokens.spacing.md }}>
        {note !== null && (
          <Text variant="note" tone="secondary">
            {note}
          </Text>
        )}

        <Divider />

        {/* "Why this?" — the opt-in explanation (D-003 Step 4/5). Collapsed by default so the
            screen stays calm; expanded it states the warmth reasoning and the honest limits of
            the color guidance (self-chosen palette, approximate families). Advisory, never a
            lecture. A quiet ghost toggle, left-aligned. */}
        <Button
          label={showWhy ? 'Hide why' : 'Why this?'}
          intent="ghost"
          onPress={() => setShowWhy((prev) => !prev)}
          style={{ alignSelf: 'flex-start' }}
        />
        {showWhy && (
          <View style={{ gap: tokens.spacing.xs }}>
            {rationale.map((line) => (
              <Text key={line} variant="caption" tone="secondary">
                {line}
              </Text>
            ))}
          </View>
        )}

        {/* The primary action — a quiet, confident underlined link, not a shouting pill (law 3).
            Logs the WHOLE look, not just the hero: the suggestion is a multi-item outfit
            ("with black denim & boots"), so wearing it is a wear of every selected piece.
            Submitted SEQUENTIALLY, matching LaundryScreen/AddGarmentScreen — there is no batch
            wear endpoint, and firing N at once would race the shared wardrobe/recent-wears cache
            invalidation each mutation triggers. Each row gets its OWN minted client_id: the
            wear_log UNIQUE index is (user_id, client_id) (migration 0006), so a single shared id
            would silently dedup all but the first row. Minted at tap time (idempotency: a
            react-query retry reuses the same client_id and replays instead of double-logging). */}
        <Button
          label={loggingWear ? 'Logging…' : 'Wore this today'}
          intent="link"
          disabled={loggingWear}
          onPress={() => void logWholeLook()}
          style={{ marginTop: tokens.spacing.sm }}
        />
      </Entrance>
    </Screen>
  );
}
