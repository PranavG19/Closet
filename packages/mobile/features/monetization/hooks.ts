// react-query hooks over BillingPort, matching the pattern in src/api/hooks.ts: screens
// consume these (never the port directly) so loading/error/pending state is uniform and a
// test can inject a fake port through BillingProvider.
import {
  useQuery,
  useMutation,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { SubscriptionOffer, PurchaseOutcome } from '@closet/shared';
import { useBillingPort } from '../../src/billing/index.js';

export const billingKeys = {
  offer: () => ['billing', 'offer'] as const,
} as const;

// The store's current offer, or null when it has none for this build/storefront.
//
// `retry: 1` and a long staleTime: the offer is effectively static for a session, and a
// store round-trip is slow. But it is NOT cached indefinitely — a storefront change or a
// newly-approved product should be picked up without a reinstall.
export function useOffer(): UseQueryResult<SubscriptionOffer | null> {
  const port = useBillingPort();
  return useQuery({
    queryKey: billingKeys.offer(),
    queryFn: () => port.getOffer(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

// A purchase attempt. NOTE the return type: a PurchaseOutcome, not a void success — a
// cancellation is a normal outcome that resolves, not an error that rejects, so the screen
// can stay silent for it instead of showing an alert on a dismissed sheet.
//
// `retry: 0` is deliberate and load-bearing: this is a MONEY call. An automatic retry of a
// purchase is never correct — the store owns idempotency, and a retry on an ambiguous
// failure risks a second charge or a second sheet.
export function usePurchase(): UseMutationResult<PurchaseOutcome, Error, string> {
  const port = useBillingPort();
  return useMutation({
    mutationFn: (productId: string) => port.purchase(productId),
    retry: 0,
  });
}

// Restore. Apple requires this control for auto-renewable subscriptions
// (docs/legal/subscription-terms.md §7) so a reinstalling member is not asked to pay twice.
export function useRestore(): UseMutationResult<{ readonly restored: boolean }, Error, void> {
  const port = useBillingPort();
  return useMutation({
    mutationFn: () => port.restore(),
    retry: 0,
  });
}
