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
  DeleteOutfitResult,
  LogWearRequest,
  UpsertPaletteRequest,
  CreateParseJobRequest,
  WardrobeItemRow,
  OutfitRow,
  OutfitListResponse,
  WearLogRow,
  PaletteProfileRow,
  PaletteReadResponse,
  EntitlementResponse,
} from '@closet/shared';
import type {
  WardrobeListResult,
  DedupeResolveResult,
  ParseResultResponse,
  DeleteAccountResult,
  ExportDocument,
} from './schemas.js';
import type { ListWardrobeParams, DedupeResolveParams, ApiClient } from './client.js';
import { useApiClient } from './ApiProvider.js';

// Stable query keys — colocated so invalidation after a mutation targets the right
// cache slice.
export const queryKeys = {
  wardrobe: (params: ListWardrobeParams) => ['wardrobe', params] as const,
  outfits: () => ['outfits'] as const,
  entitlement: () => ['entitlement'] as const,
  palette: () => ['palette'] as const,
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

// The self-identified palette (B1), read for the daily suggestion's advisory tie-break.
// An absent palette resolves to { hues: [] } server-side, so a user who hasn't taken the
// quiz gets a clean empty list rather than an error — the suggestion screen then simply
// runs without a colour signal.
export function usePalette(): UseQueryResult<PaletteReadResponse> {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.palette(), queryFn: () => client.readPalette() });
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

// Delete an outfit by id. Invalidates the outfits list so the removed card disappears on a
// confirmed delete. The mutation variable is the outfit id (string).
export function useDeleteOutfit(): UseMutationResult<DeleteOutfitResult, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteOutfit(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.outfits() });
    },
  });
}

// Rename an outfit. The mutation variable is { id, name } (name null clears it). Invalidates
// the outfits list so the card shows the new name on a confirmed rename.
export function useRenameOutfit(): UseMutationResult<OutfitRow, Error, { id: string; name: string | null }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string | null }) => client.renameOutfit(id, name),
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: UpsertPaletteRequest) => client.upsertPalette(request),
    // Saving the quiz must refresh the palette read so today's suggestion picks up the new
    // colours immediately (the tie-break + the "we leaned toward your palette" rationale).
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.palette() });
    },
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

// --- account (self-service) -------------------------------------------------
// The export is a MUTATION, not a useQuery: it must fire only when she taps
// "Export my data". As a query it would auto-fetch on mount (and refetch on focus),
// pulling her entire wardrobe history down every time the Account tab is opened.
export function useExportMyData(): UseMutationResult<ExportDocument, Error, void> {
  const client = useApiClient();
  return useMutation({ mutationFn: () => client.exportMyData() });
}

// IRREVERSIBLE. `retry: 0` is deliberate: react-query's default retry would re-POST
// the purge after a timeout whose request may well have SUCCEEDED server-side, and
// the second call would 500 on an already-emptied account — turning a completed
// deletion into a scary error. One attempt; she re-taps if it genuinely failed.
//
// On success the whole cache is cleared before sign-out, so no wardrobe page from
// the deleted account can be re-rendered from cache by the next user on the device.
export function useDeleteAccount(): UseMutationResult<DeleteAccountResult, Error, 'DELETE'> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: (confirm: 'DELETE') => client.deleteAccount(confirm),
    onSuccess: () => {
      qc.clear();
    },
  });
}

// Re-export the client type for provider typing.
export type { ApiClient };
