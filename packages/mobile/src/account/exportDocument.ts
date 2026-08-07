// Pure helpers for presenting the subject-access export document. Kept out of the
// screen so they are unit-testable, and under src/ so the test lands in the `unit`
// vitest project.
import type { ExportDocument } from '../api/schemas.js';

// The row counts shown as a receipt ("here is what we sent you"), so an export that
// silently came back empty is visible rather than a successful-looking no-op.
export interface ExportSummary {
  readonly wardrobeItems: number;
  readonly parseJobs: number;
  readonly outfits: number;
  readonly wearLogEntries: number;
  readonly hasPalette: boolean;
  readonly hasSubscription: boolean;
}

export function summarizeExport(document: ExportDocument): ExportSummary {
  return {
    wardrobeItems: document.wardrobe_items.length,
    parseJobs: document.parse_jobs.length,
    outfits: document.outfits.length,
    wearLogEntries: document.wear_log.length,
    hasPalette: document.palette_profile !== null,
    hasSubscription: document.subscription !== null,
  };
}

// The document as the text she receives/saves. Pretty-printed (2-space) because a
// subject-access response is meant to be READ by a person, not just machine-parsed.
export function serializeExport(document: ExportDocument): string {
  return JSON.stringify(document, null, 2);
}
