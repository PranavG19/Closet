// The PhotoIntakePort's React seam, mirroring BillingProvider exactly (same reason, harder
// case): a picker / screener / EXIF re-encoder are all native modules, so a direct import
// would make AddGarmentScreen unrenderable and untestable outside a device build.
//
// There is deliberately NO DEFAULT PORT. A missing provider throws rather than silently
// resolving to a stub reporting `available: false`, because a stub would render the "photo
// import isn't available yet" state on a correctly-configured build and look like a device
// problem rather than a wiring bug. Same call as BillingProvider.
import React from 'react';
import type { PhotoIntakePort } from '@closet/shared';

const PhotoIntakeContext = React.createContext<PhotoIntakePort | null>(null);

export interface PhotoIntakeProviderProps {
  readonly port: PhotoIntakePort;
  readonly children: React.ReactNode;
}

export function PhotoIntakeProvider({ port, children }: PhotoIntakeProviderProps): React.JSX.Element {
  return <PhotoIntakeContext.Provider value={port}>{children}</PhotoIntakeContext.Provider>;
}

export function usePhotoIntakePort(): PhotoIntakePort {
  const port = React.useContext(PhotoIntakeContext);
  if (port === null) {
    throw new Error('usePhotoIntakePort must be used inside a PhotoIntakeProvider.');
  }
  return port;
}
