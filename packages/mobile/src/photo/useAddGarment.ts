// The react-query shell over addApprovedGarment. It holds NO logic — every decision lives
// in addGarment.ts / uploadApproved.ts, which are pure and actually tested (a `.test.tsx`
// matches no vitest glob in this repo, so a hook's own behaviour is not unit-testable here).
//
// THE MUTATION VARIABLE IS AN ALREADY-APPROVED PHOTO. Nothing is minted inside mutationFn:
// the hash arrives on the ApprovedPhoto, computed when she tapped approve. That is the
// CLAUDE.md rule that applies to client_id, and it applies for the same reason — a
// react-query retry re-sends the SAME variables object, so the same idempotency key, so
// Storage upserts the same object and parse-photo replays instead of creating a second job
// and burning a second teaser-cap slot.
//
// `retry: 0`: a parse is metered (teaser cap) and, for kind='full', PAID. An automatic
// retry on an ambiguous failure is never right here — the 409 already-parsing and the 429
// rate-limited cases both mean "wait", not "send it again immediately". Same reasoning as
// usePurchase / useDeleteAccount.
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ApprovedPhoto, CreateParseJobRequest, ParseJobKind, Sha256Hex } from '@closet/shared';
import type { ParseResultResponse } from '../api/schemas.js';
import { useApiClient } from '../api/ApiProvider.js';
import { getSupabase } from '../api/supabase.js';
import { addApprovedGarment, type AddGarmentUploadInput } from './addGarment.js';
import { uploadApprovedPhoto, type UploadedPhotoRef } from './uploadApproved.js';

export interface AddGarmentVariables {
  readonly photo: ApprovedPhoto;
  readonly kind: ParseJobKind;
}

// `sha256Hex` is the SAME digest port the approval tap used to mint the brand. It is passed
// in rather than bound here so the upload chokepoint's hash re-check (its runtime backstop
// against a laundered brand) cannot silently disagree with the minter.
export function useAddGarment(
  userId: string,
  sha256Hex: Sha256Hex,
): UseMutationResult<ParseResultResponse, Error, AddGarmentVariables> {
  const client = useApiClient();
  const qc = useQueryClient();

  return useMutation({
    retry: 0,
    mutationFn: (variables: AddGarmentVariables) =>
      addApprovedGarment(
        {
          userId,
          // The ONE place the real Storage client is bound to the chokepoint.
          upload: (input: AddGarmentUploadInput): Promise<UploadedPhotoRef> =>
            uploadApprovedPhoto({ client: getSupabase(), sha256Hex, ...input }),
          parsePhoto: (request: CreateParseJobRequest) => client.parsePhoto(request),
        },
        variables,
      ),
    onSuccess: () => {
      // A completed parse writes wardrobe_items, so the closet is stale.
      void qc.invalidateQueries({ queryKey: ['wardrobe'] });
    },
  });
}
