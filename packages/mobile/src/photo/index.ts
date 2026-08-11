// The photo upload seam. `uploadApprovedPhoto` is the ONLY code in this package that
// writes bytes to the `originals` bucket (chokepoint.test.ts fails if a second appears),
// and it accepts ONLY an ApprovedPhoto — a branded type from @closet/shared whose sole
// constructor is approvePhoto(), which the approval-tap handler calls. So an unapproved
// photo has no representable upload path.
export { uploadApprovedPhoto, ORIGINALS_BUCKET, PhotoUploadError } from './uploadApproved.js';
export type { UploadApprovedPhotoInput, UploadedPhotoRef } from './uploadApproved.js';
export { addApprovedGarment, classifyParseFailure } from './addGarment.js';
export type {
  AddGarmentDeps,
  AddGarmentInput,
  AddGarmentOutcome,
  AddGarmentUploadInput,
} from './addGarment.js';
export { useAddGarment } from './useAddGarment.js';
export type { AddGarmentVariables } from './useAddGarment.js';
// The on-device intake seam: the PhotoIntakePort's React context, the one module that would
// bind a native picker, and the byte→hex hasher. Only src/App.tsx calls makePhotoIntakePort.
export { PhotoIntakeProvider, usePhotoIntakePort } from './PhotoIntakeProvider.js';
export type { PhotoIntakeProviderProps } from './PhotoIntakeProvider.js';
export { makePhotoIntakePort } from './photoIntakeNative.js';
export { makeSha256Hex } from './sha256Hex.js';
export type { DigestSurface } from './sha256Hex.js';
