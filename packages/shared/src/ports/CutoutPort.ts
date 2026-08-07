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

// Port-owned input — no vendor type. The approved original in Storage.
export interface CutoutInput {
  readonly imageUrl: string;
}

export interface CutoutPort {
  removeBackground(input: CutoutInput): Promise<CutoutResult>;
}
