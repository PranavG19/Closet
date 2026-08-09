// The typed API client — the ONLY way mobile talks to the Edge Functions, and the
// only table read/write path (repos-only: mobile never calls supabase.from()).
//
// Every method:
//   1. attaches the current supabase session JWT as the Bearer (identity is the
//      verified `sub`, derived server-side — never sent in the body);
//   2. posts/gets the matching route from routes.ts;
//   3. parses the response body through its @closet/shared (or locally-mirrored)
//      Zod schema via parseBoundary — parse-don't-cast, NO `as` across the wire.
//
// client_id for a wear-log is a REQUIRED method argument, minted by the CALLER at
// tap time (never inside a mutationFn) — a retry reuses the same id so the partial
// UNIQUE index dedups it. See logWear below.
import {
  parseBoundary,
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
  // The error envelope is declared in shared so this client and the server's
  // errorResponse() cannot drift — they used to, silently. See schemas/errors.ts.
  ErrorEnvelope,
} from '@closet/shared';
import {
  WardrobeListResult,
  DedupeResolveResult,
  ParseResultResponse,
  DeleteAccountRequest,
  DeleteAccountResult,
  ExportDocument,
} from './schemas.js';
import { ROUTES, type RouteName } from './routes.js';
import { loadConfig, type AppConfig } from './config.js';

// The narrow query-string shape the wardrobe list accepts. Kept local (not a
// request body) — the server clamps limit regardless.
export interface ListWardrobeParams {
  readonly category?: string;
  readonly color?: string;
  readonly availability?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

// A dedupe keep-one request (defined in @closet/functions, mirrored here — mobile
// cannot import functions). keep_id/discard_id must differ (server also refuses).
export interface DedupeResolveParams {
  readonly keep_id: string;
  readonly discard_id: string;
}

// The bearer-token source. Injected so a unit test drives the client with a fake
// token + fake fetch and no Supabase runtime.
export type TokenSource = () => Promise<string | null>;

export interface ApiClientDeps {
  // Defaults to the global fetch; injectable for tests.
  readonly fetchFn?: typeof fetch;
  readonly getToken: TokenSource;
  readonly config?: AppConfig;
}

// A typed transport error the caller (and react-query) can branch on. Carries the
// HTTP status and a short code; NEVER the raw server message verbatim in a way
// that would surface PII — the code + status are the contract.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}


export class ApiClient {
  private readonly fetchFn: typeof fetch;
  private readonly getToken: TokenSource;
  private readonly config: AppConfig;

  constructor(deps: ApiClientDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.getToken = deps.getToken;
    this.config = deps.config ?? loadConfig();
  }

  private url(route: RouteName, query?: string): string {
    const base = this.config.functionsBaseUrl.replace(/\/+$/, '');
    return `${base}/${ROUTES[route].path}${query ?? ''}`;
  }

  // Core request: attach bearer, send, and hand the raw JSON body to a parser.
  // The parser (a Zod schema via parseBoundary) is what turns the untyped body
  // into a typed value — no `as`. A non-2xx becomes a typed ApiError.
  private async request<T>(
    route: RouteName,
    parse: (body: unknown) => T,
    init?: { body?: unknown; query?: string },
  ): Promise<T> {
    const token = await this.getToken();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token !== null) headers.authorization = `Bearer ${token}`;

    const method = ROUTES[route].method;
    const requestInit: RequestInit = { method, headers };
    if (init?.body !== undefined) requestInit.body = JSON.stringify(init.body);

    const response = await this.fetchFn(this.url(route, init?.query), requestInit);
    const raw: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const parsed = ErrorEnvelope.safeParse(raw);
      const { code, message } = parsed.success
        ? parsed.data.error
        : { code: 'error', message: 'Request failed.' };
      throw new ApiError(response.status, code, message);
    }
    return parse(raw);
  }

  private queryString(params: ListWardrobeParams): string {
    const search = new URLSearchParams();
    if (params.category !== undefined) search.set('category', params.category);
    if (params.color !== undefined) search.set('color', params.color);
    if (params.availability !== undefined) search.set('availability', params.availability);
    if (params.cursor !== undefined) search.set('cursor', params.cursor);
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    const s = search.toString();
    return s.length > 0 ? `?${s}` : '';
  }

  // --- wardrobe ------------------------------------------------------------
  listWardrobe(params: ListWardrobeParams = {}): Promise<WardrobeListResult> {
    return this.request(
      'listWardrobe',
      (body) => parseBoundary(WardrobeListResult, body, 'listWardrobe'),
      { query: this.queryString(params) },
    );
  }

  toggleAvailability(request: UpdateAvailabilityRequest): Promise<WardrobeItemRow> {
    const body = parseBoundary(UpdateAvailabilityRequest, request, 'toggleAvailability.request');
    return this.request(
      'toggleAvailability',
      (res) => parseBoundary(WardrobeItemRow, res, 'toggleAvailability'),
      { body },
    );
  }

  resolveDedupe(request: DedupeResolveParams): Promise<DedupeResolveResult> {
    return this.request(
      'resolveDedupe',
      (res) => parseBoundary(DedupeResolveResult, res, 'resolveDedupe'),
      { body: request },
    );
  }

  // --- outfits -------------------------------------------------------------
  createOutfit(request: CreateOutfitRequest): Promise<OutfitRow> {
    const body = parseBoundary(CreateOutfitRequest, request, 'createOutfit.request');
    return this.request('createOutfit', (res) => parseBoundary(OutfitRow, res, 'createOutfit'), {
      body,
    });
  }

  listOutfits(): Promise<OutfitListResponse> {
    return this.request('listOutfits', (res) => parseBoundary(OutfitListResponse, res, 'listOutfits'));
  }

  // --- wear-log ------------------------------------------------------------
  // client_id is a REQUIRED argument minted by the caller at tap time (idempotency
  // key). It is intentionally NOT minted here — minting inside would make a retry
  // produce a fresh id and duplicate the row past the partial UNIQUE index.
  logWear(request: LogWearRequest): Promise<WearLogRow> {
    const body = parseBoundary(LogWearRequest, request, 'logWear.request');
    return this.request('logWear', (res) => parseBoundary(WearLogRow, res, 'logWear'), { body });
  }

  // --- palette -------------------------------------------------------------
  upsertPalette(request: UpsertPaletteRequest): Promise<PaletteProfileRow> {
    const body = parseBoundary(UpsertPaletteRequest, request, 'upsertPalette.request');
    return this.request(
      'upsertPalette',
      (res) => parseBoundary(PaletteProfileRow, res, 'upsertPalette'),
      { body },
    );
  }

  readEntitlement(): Promise<EntitlementResponse> {
    return this.request('readEntitlement', (res) =>
      parseBoundary(EntitlementResponse, res, 'readEntitlement'),
    );
  }

  // --- parse-photo ---------------------------------------------------------
  parsePhoto(request: CreateParseJobRequest): Promise<ParseResultResponse> {
    const body = parseBoundary(CreateParseJobRequest, request, 'parsePhoto.request');
    return this.request('parsePhoto', (res) => parseBoundary(ParseResultResponse, res, 'parsePhoto'), {
      body,
    });
  }

  // --- account (self-service) ----------------------------------------------
  // IRREVERSIBLE. `confirm` is typed as the literal 'DELETE' AND re-parsed through
  // the .strict() request schema, so a wrong value throws SYNCHRONOUSLY — before any
  // network call — rather than reaching the purge endpoint. Identity is the bearer's
  // verified `sub`; there is deliberately no user-id argument, so "delete someone
  // else's account" is not a representable call.
  deleteAccount(confirm: 'DELETE'): Promise<DeleteAccountResult> {
    const body = parseBoundary(DeleteAccountRequest, { confirm }, 'deleteAccount.request');
    return this.request(
      'deleteAccount',
      (res) => parseBoundary(DeleteAccountResult, res, 'deleteAccount'),
      { body },
    );
  }

  // The GDPR Art. 15 subject-access document. Parsed through ExportDocument so a
  // malformed export is a thrown error, not a half-typed JSON blob handed to a
  // Share sheet as though it were complete.
  exportMyData(): Promise<ExportDocument> {
    return this.request('exportMyData', (res) =>
      parseBoundary(ExportDocument, res, 'exportMyData'),
    );
  }
}

// A default client wired to the real Supabase session token. Constructed lazily so
// missing config surfaces at first call, not at import.
let defaultClient: ApiClient | undefined;

export function getApiClient(getToken: TokenSource): ApiClient {
  defaultClient ??= new ApiClient({ getToken });
  return defaultClient;
}
