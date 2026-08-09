// Wardrobe grid — the signature surface (docs/03). Cutouts sit centered on a
// bg.sunken well so garments feel lifted off the page.
//
// THE CUTOUTS NOW ACTUALLY RENDER. Every tile previously drew a grey square with the
// category name in it — for a wardrobe app, whose entire proposition is seeing your clothes
// as clean cutouts, the one thing the screen existed to show was the one thing it did not.
// `cutout_path` was fetched, parsed, and threaded all the way to the client, then read by
// nothing.
//
// The bytes need a SIGNED URL: the `cutouts` bucket is private and its RLS policy binds the
// first path segment to auth.uid(), and <Image> cannot carry our JWT. See src/storage/cutoutUri.ts.
//
// VISUAL CORRECTNESS IS UNVERIFIED (human-gated) — no simulator in this build.
import React from 'react';
import { View, Image, type ViewStyle, type ImageStyle } from 'react-native';
import type { WardrobeItemRow } from '@closet/shared';
import { useTokens } from '../../src/tokens/index.js';
import { useWardrobe } from '../../src/api/index.js';
import {
  Screen,
  Card,
  Text,
  AvailabilityChip,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../../src/ui/index.js';
import { useCutoutUris } from '../../src/storage/index.js';

function ItemTile({
  item,
  cutoutUri,
}: {
  readonly item: WardrobeItemRow;
  // Undefined when there is no cutout yet (garment added before its parse finished) or the
  // URL could not be signed. Either way the well below is drawn empty — the tile degrades,
  // the screen does not.
  readonly cutoutUri: string | undefined;
}): React.JSX.Element {
  const tokens = useTokens();
  const tile: ViewStyle = { width: '48%', marginBottom: tokens.spacing.lg };
  // The sunken well the cutout sits on. It stays behind the image rather than being replaced
  // by it: a PNG cutout is alpha-composited (CutoutPort guarantees `hasAlpha`), so the well
  // IS the backdrop the garment is lifted off, not a placeholder to swap out.
  const well: ViewStyle = {
    aspectRatio: 1,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.spacing.sm,
    // Clip the image to the rounded corners; without this the PNG's square bounds bleed
    // past the radius on Android.
    overflow: 'hidden',
  };
  // `contain`, never `cover`: a cutout cropped to fill the square would cut the sleeves off
  // a coat. The whole garment has to be visible — that is the product.
  const image: ImageStyle = { width: '100%', height: '100%', resizeMode: 'contain' };
  return (
    <View style={tile}>
      <View style={well} accessibilityLabel={`${item.category} garment`}>
        {cutoutUri !== undefined ? (
          <Image
            source={{ uri: cutoutUri }}
            style={image}
            // The tile's own accessibilityLabel already names the garment, so the image is
            // decorative to a screen reader — labelling it again would read the category
            // twice.
            accessible={false}
          />
        ) : (
          <Text variant="caption" tone="tertiary">
            {item.category}
          </Text>
        )}
      </View>
      <Text variant="body" tone="primary">
        {item.color ?? item.category}
      </Text>
      <AvailabilityChip availability={item.availability} style={{ marginTop: tokens.spacing.xs }} />
    </View>
  );
}

export function WardrobeScreen(): React.JSX.Element {
  const tokens = useTokens();
  const query = useWardrobe();
  // Signed image URLs, keyed by item id. A separate query from the rows because signed URLs
  // expire and rows do not (see useCutoutUris). Its loading and error states are deliberately
  // NOT gated on: the closet renders immediately with empty wells and the garments appear as
  // their URLs arrive, rather than the whole grid waiting on image signing.
  const cutouts = useCutoutUris(query.data?.items ?? []);

  if (query.isPending) return <LoadingState message="Loading your closet…" />;
  if (query.isError) {
    return <ErrorState body="We couldn't load your closet." onRetry={() => void query.refetch()} />;
  }

  const items = query.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Your closet is empty"
        body="Add your first pieces and they'll appear here as clean cutouts."
        actionLabel="Add clothing"
        onAction={() => {}}
      />
    );
  }

  const grid: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' };
  return (
    <Screen scroll padding="lg">
      <Text variant="display" tone="primary" style={{ marginBottom: tokens.spacing.lg }}>
        Your closet
      </Text>
      <Card variant="sunken" padding="md" style={grid}>
        {items.map((item) => (
          <ItemTile key={item.id} item={item} cutoutUri={cutouts.data?.[item.id]} />
        ))}
      </Card>
    </Screen>
  );
}
