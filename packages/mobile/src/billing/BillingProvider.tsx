// The BillingPort's React seam. The port is provided via context rather than imported
// directly by the screen for one concrete reason: `react-native-purchases` is a native
// module, so a direct import makes PaywallScreen unrenderable and untestable outside a
// device build — and the paywall is the single screen Apple review scrutinises hardest.
//
// There is deliberately NO DEFAULT PORT. A missing provider throws instead of silently
// resolving to a stub that reports "no offer", because a stub would render the
// "membership isn't available" state on a correctly-configured build and look like a
// store outage rather than a wiring bug.
import React from 'react';
import type { BillingPort } from '@closet/shared';

const BillingContext = React.createContext<BillingPort | null>(null);

export interface BillingProviderProps {
  readonly port: BillingPort;
  readonly children: React.ReactNode;
}

export function BillingProvider({ port, children }: BillingProviderProps): React.JSX.Element {
  return <BillingContext.Provider value={port}>{children}</BillingContext.Provider>;
}

export function useBillingPort(): BillingPort {
  const port = React.useContext(BillingContext);
  if (port === null) {
    throw new Error('useBillingPort must be used inside a BillingProvider.');
  }
  return port;
}
