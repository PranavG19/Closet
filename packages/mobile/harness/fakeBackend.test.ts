// Independent oracle for the harness canned data: drive every ApiClient method that a
// screen calls through a REAL ApiClient wired to the fake backend, and assert the client
// parses the response through parseBoundary WITHOUT throwing. The client's parse layer is
// the oracle — it is NOT code this harness wrote, so a mis-shaped fixture (a bad
// timestamp, a URL where a storage key belongs, a missing field) fails here rather than
// silently at a screen on the simulator.
//
// NOTE on running: the vitest `unit` project globs packages/*/src and packages/*/features
// only, so a test under harness/ is NOT picked up by a bare `vitest run packages/mobile`.
// Run it by explicit path: `pnpm -w exec vitest run packages/mobile/harness`. It is still
// TYPECHECKED by src/photo/testFilesTypecheck.test.ts, which walks all of packages/mobile.
import { describe, it, expect } from 'vitest';
// Import the client + config DIRECTLY, not through ../src/api/index.js: the barrel also
// re-exports ApiProvider (React) and supabase.ts (react-native), and react-native's Flow
// source cannot be parsed in the vitest transform. client.test.ts imports the same way.
import { ApiClient } from '../src/api/client.js';
import type { AppConfig } from '../src/api/config.js';
import { makeFakeBackend } from './fakeBackend.js';
import { HARNESS_SESSION } from './fakeAuthPort.js';

const CONFIG: AppConfig = {
  supabaseUrl: 'https://harness.supabase.invalid',
  supabaseAnonKey: 'harness-anon-key',
  functionsBaseUrl: 'https://harness.supabase.invalid/functions/v1',
};

function makeClient(entitlementActive: boolean): ApiClient {
  return new ApiClient({
    fetchFn: makeFakeBackend({ entitlementActive }),
    getToken: async () => HARNESS_SESSION.accessToken,
    config: CONFIG,
  });
}

describe('harness fake backend — canned data is schema-valid (parses through the real client)', () => {
  it('listWardrobe returns items that parse, with varied categories/availability and a cutout', async () => {
    const result = await makeClient(true).listWardrobe();
    expect(result.items.length).toBeGreaterThanOrEqual(4);
    expect(new Set(result.items.map((i) => i.category)).size).toBeGreaterThanOrEqual(4);
    expect(result.items.some((i) => i.cutout_path !== null)).toBe(true);
    expect(result.items.some((i) => i.availability === 'dirty')).toBe(true);
    expect(result.next_cursor).toBeNull();
  });

  it('listWardrobe honors the F4 filters (category + availability narrow the set)', async () => {
    const client = makeClient(true);
    const dresses = await client.listWardrobe({ category: 'dress' });
    expect(dresses.items).toHaveLength(1);
    expect(dresses.items[0]?.category).toBe('dress');
    const clean = await client.listWardrobe({ availability: 'clean' });
    expect(clean.items.length).toBeGreaterThanOrEqual(1);
    expect(clean.items.every((i) => i.availability === 'clean')).toBe(true);
    // A combined filter with no match returns an empty page (the "no matches" state), NOT all.
    const none = await client.listWardrobe({ category: 'dress', availability: 'clean' });
    expect(none.items).toHaveLength(0);
  });

  it('listOutfits returns 2 outfits that parse', async () => {
    const result = await makeClient(true).listOutfits();
    expect(result.outfits.length).toBe(2);
  });

  it('readEntitlement parses the ACTIVE (member) state', async () => {
    const result = await makeClient(true).readEntitlement();
    expect(result.entitlement_active).toBe(true);
    expect(result.expires_at).not.toBeNull();
  });

  it('readEntitlement parses the INACTIVE (offer) state', async () => {
    const result = await makeClient(false).readEntitlement();
    expect(result.entitlement_active).toBe(false);
    expect(result.expires_at).toBeNull();
  });

  it('readPalette parses the normalised family-token list', async () => {
    const result = await makeClient(true).readPalette();
    expect(result.hues).toEqual(['camel', 'rose']);
  });

  it('exportMyData parses the full subject-access document', async () => {
    const doc = await makeClient(true).exportMyData();
    expect(doc.wardrobe_items.length).toBeGreaterThan(0);
    expect(doc.outfits.length).toBe(2);
    expect(doc.subscription).not.toBeNull();
    expect(doc.parse_jobs.length).toBe(1);
  });

  it('mutation responses parse: toggleAvailability, createOutfit, logWear, upsertPalette, resolveDedupe, parsePhoto, deleteAccount', async () => {
    const client = makeClient(true);
    const item = '11111111-1111-4111-8111-111111111111';
    await expect(client.toggleAvailability({ item_id: item, availability: 'dirty' })).resolves.toBeDefined();
    await expect(client.createOutfit({ items: [{ item_id: item }] })).resolves.toBeDefined();
    await expect(client.logWear({ item_id: item, client_id: 'harness-tap' })).resolves.toBeDefined();
    await expect(client.upsertPalette({ hues: { season: 'autumn' } })).resolves.toBeDefined();
    await expect(client.resolveDedupe({ keep_id: item, discard_id: '22222222-2222-4222-8222-222222222222' })).resolves.toEqual({ merged: true });
    await expect(client.parsePhoto({ source_photo_hash: 'harnesshash0001', kind: 'teaser' })).resolves.toBeDefined();
    await expect(client.deleteAccount('DELETE')).resolves.toBeDefined();
  });
});
