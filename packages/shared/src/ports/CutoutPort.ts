// CutoutPort — background removal → normalized front-view cutout (docs/06 §5).
// A cutout vendor sits behind this port; it is a drop-in swap without touching
// callers. No vendor type leaks — only a Zod-validated result crosses.
import { z } from 'zod';

export const CutoutResultSchema = z.object({
  // Storage path the cutout was written to (bytes never transit Edge as objects).
  imageUrl: z.string(),
  // a cutout is alpha-composited by definition; the flag documents that guarantee.
  hasAlpha: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CutoutResult = z.infer<typeof CutoutResultSchema>;

// Port-owned input — no vendor type. `imageUrl` is the approved original in Storage.
//
// `userId` + `parseJobId` are part of the CONTRACT because the cutout's Storage path
// is a SECURITY BOUNDARY, not a naming convention. Migration 0013's Storage RLS
// policy on the `cutouts` bucket is
//   bucket_id = 'cutouts' AND (storage.foldername(name))[1] = auth.uid()::text
// so the FIRST path segment MUST be the owning user_id or the write is REFUSED by
// RLS. An implementation therefore cannot compose a writable path from `imageUrl`
// alone — withholding these fields does not make the port safer, it makes every
// correct implementation impossible. Both values MUST originate from the verified
// JWT `sub` and the claimed `parse_jobs` row, NEVER from a request body: a
// body-sourced userId here would compose a path into another tenant's prefix and
// (only) RLS would stop it. Path obscurity is never the control; the policy is.
export interface CutoutInput {
  readonly imageUrl: string;
  readonly userId: string;
  readonly parseJobId: string;
}

export interface CutoutPort {
  removeBackground(input: CutoutInput): Promise<CutoutResult>;
}
