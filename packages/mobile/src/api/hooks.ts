// react-query hooks wrapping the typed ApiClient. Screens consume THESE (not the
// client directly) so loading/error/refetch state is uniform. The client is read
// from ApiProvider context so a test / preview can inject a fake.
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  UpdateAvailabilityRequest,
  CreateOutfitRequest,
  LogWearRequest,
  UpsertPaletteRequest,
  CreateParseJobRequest,
  WardrobeItemRow,
  OutfitRow,
  OutfitListResponse,
  WearLogRow,
  PaletteProfileRow,
  EntitlementResponse,
} from '@closet/shared';
import type { WardrobeListResult, DedupeResolveResult, ParseResultResponse } from './schemas.js';
import type { ListWardrobeParams, DedupeResolveParams, ApiClient } from './client.js';
import { useApiClient } from './ApiProvider.js';

// Stable query keys — colocated so invalidation after a mutation targets the right
// cache slice.
export const queryKeys = {
  wardrobe: (params: ListWardrobeParams) => ['wardrobe', params] as const,
  outfits: () => ['outfits'] as const,
  entitlement: () => ['entitlement'] as const,
} as const;

export function useWardrobe(params: ListWardrobeParams = {}): UseQueryResult<WardrobeListResult> {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.wardrobe(params),
    queryFn: () => client.listWardrobe(params),
  });
}

export function useOutfits(): UseQueryResult<OutfitListResponse> {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.outfits(), queryFn: () => client.listOutfits() });
}

export function useEntitlement(): UseQueryResult<EntitlementResponse> {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.entitlement(), queryFn: () => client.readEntitlement() });
}

export function useToggleAvailability(): UseMutationResult<
  WardrobeItemRow,
  Error,
  UpdateAvailabilityRequest
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateAvailabilityRequest) => client.toggleAvailability(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wardrobe'] });
    },
  });
}

export function useResolveDedupe(): UseMutationResult<DedupeResolveResult, Error, DedupeResolveParams> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: DedupeResolveParams) => client.resolveDedupe(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wardrobe'] });
    },
  });
}

export function useCreateOutfit(): UseMutationResult<OutfitRow, Error, CreateOutfitRequest> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateOutfitRequest) => client.createOutfit(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.outfits() });
    },
  });
}

// The wear-log mutation. The CALLER passes a fully-formed LogWearRequest whose
// client_id it minted at tap time (uuid) — this hook does NOT mint it, so a
// react-query retry re-sends the SAME client_id and the partial UNIQUE index
// dedups the write rather than appending a duplicate wear row.
export function useLogWear(): UseMutationResult<WearLogRow, Error, LogWearRequest> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: LogWearRequest) => client.logWear(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wardrobe'] });
    },
  });
}

export function useUpsertPalette(): UseMutationResult<PaletteProfileRow, Error, UpsertPaletteRequest> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (request: UpsertPaletteRequest) => client.upsertPalette(request),
  });
}

export function useParsePhoto(): UseMutationResult<ParseResultResponse, Error, CreateParseJobRequest> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateParseJobRequest) => client.parsePhoto(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wardrobe'] });
    },
  });
}

// Re-export the client type for provider typing.
export type { ApiClient };
