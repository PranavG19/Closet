// Independent oracle for the outfits endpoint (task-11, D-001). Idempotent create
// (client-minted id), composite-FK cross-tenant rejection, isolation — handlers
// through the real withAuth as app_user against real Postgres. State is read from
// a superuser count, never the handler's own return value.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { OutfitRow } from '@closet/shared';
import { createOutfit } from '../src/outfits/create.js';
import { listOutfits } from '../src/outfits/list.js';
import { deleteOutfit } from '../src/outfits/delete.js';
import { renameOutfit } from '../src/outfits/rename.js';
import {
  applyMigrations,
  expectRlsDenies,
  makeCaller,
  makeSuperuserExecutor,
  makeTenantExecutor,
  startPg,
  type Caller,
  type PgHarness,
  type QueryExecutor,
} from './helpers/harness.js';

const USER_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const USER_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

async function seedItem(exec: QueryExecutor, userId: string): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO public.wardrobe_items (user_id, category) VALUES ($1,'top') RETURNING id`,
    [userId],
  );
  return rows[0]!.id;
}

describe('outfits endpoint — idempotent create + FK isolation', () => {
  let harness: PgHarness;
  let pool: Pool;
  let callerA: Caller;
  let execA: QueryExecutor;
  let superuser: QueryExecutor;

  beforeAll(async () => {
    harness = await startPg();
    pool = harness.pool;
    await applyMigrations(pool);
    callerA = makeCaller(pool, USER_A);
    execA = makeTenantExecutor(pool, USER_A);
    superuser = makeSuperuserExecutor(pool);
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // The response id is read through OutfitRow rather than an `as` cast: the cast
  // asserted the server's shape against itself, so it stayed green while the shape
  // drifted away from what the mobile client parses (see the wire-contract test).
  // The member count is still the independent oracle — a superuser SELECT, not the
  // response — so this proves the same persistence claim it always did.
  it('create returns the outfit; members persisted', async () => {
    const item = await seedItem(execA, USER_A);
    const res = await callerA.call(createOutfit, { body: { name: 'Look', items: [{ item_id: item }] } });
    expect(res.status).toBe(200);
    const outfit = OutfitRow.parse(await res.json());
    const count = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfit.id],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('idempotent create — retry with same client id → one outfit, one member', async () => {
    const item = await seedItem(execA, USER_A);
    const outfitId = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6';
    const body = { id: outfitId, name: 'Fixed', items: [{ item_id: item }] };
    const first = await callerA.call(createOutfit, { body });
    const retry = await callerA.call(createOutfit, { body });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const outfitCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [outfitId],
    );
    expect(outfitCount.rows[0]?.n).toBe('1');
    const memberCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [outfitId],
    );
    expect(memberCount.rows[0]?.n).toBe('1');
  });

  it('cross-tenant item_id → 400 (composite FK), no outfit lands', async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    const bItem = await seedItem(execB, USER_B);
    const before = await superuser.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.outfits WHERE user_id = $1`, [USER_A]);
    const res = await callerA.call(createOutfit, { body: { name: 'bad', items: [{ item_id: bItem }] } });
    expect(res.status).toBe(400);
    const after = await superuser.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.outfits WHERE user_id = $1`, [USER_A]);
    // The whole atomic statement rolled back — no orphan outfit.
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('malformed body → 400 at the boundary', async () => {
    const res = await callerA.call(createOutfit, { body: { items: 'nope' } });
    expect(res.status).toBe(400);
  });

  // An UNPARSEABLE body (dropped connection mid-POST), not merely a wrong shape.
  // 400, never 500: a 5xx tells the client (App.tsx sets retry: 1) the SERVER is at
  // fault and the request is worth resending, but this body will never parse. The
  // test above sends well-formed JSON, so it fails inside parseBoundary and never
  // reaches the req.json() throw.
  it.each([
    { label: 'empty', rawBody: '' },
    { label: 'truncated', rawBody: '{' },
  ])('create with an $label body → 400, never 500', async ({ rawBody }) => {
    const res = await callerA.call(createOutfit, { rawBody });
    expect(res.status).toBe(400);
  });

  // The WIRE CONTRACT the mobile client parses. client.ts:170 does
  // parseBoundary(OutfitRow, res) on this exact 200 body, so a nested envelope
  // makes every successful create throw client-side on a row that DID land in
  // Postgres — the user sees "save failed" on a write that succeeded. Asserting the
  // shared schema the client uses is what makes the two sides checkable; the
  // existing create test read `body.outfit.id` behind an `as` cast, which asserted
  // the server's own shape against itself and so could never catch the drift.
  it('create response parses as the OutfitRow the mobile client expects', async () => {
    const item = await seedItem(execA, USER_A);
    const res = await callerA.call(createOutfit, { body: { name: 'Wire', items: [{ item_id: item }] } });
    expect(res.status).toBe(200);
    const parsed = OutfitRow.safeParse(await res.json());
    expect(parsed.success).toBe(true);
  });

  // RENAMED + STRENGTHENED. listOutfits → repo.listByUser(ctx.userId), i.e. A's own id
  // in `WHERE user_id = $1`, so B's row is filtered out by that predicate before RLS is
  // ever consulted — this body stayed green with outfits_select_own widened to
  // USING (true) (fire-drilled). The endpoint assertion is kept: it is the wire-level
  // proof that the handler does not leak B's name to A. The RLS claim in the title is
  // now measured through A's tenant executor with no predicate, fire-drilled in-place.
  it('list excludes B outfits at the endpoint, and RLS denies A an unfiltered read', async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    await execB.query(`INSERT INTO public.outfits (user_id, name) VALUES ($1,'B-secret')`, [USER_B]);
    const res = await callerA.call(listOutfits);
    const body = (await res.json()) as { outfits: { name: string | null }[] };
    expect(body.outfits.some((o) => o.name === 'B-secret')).toBe(false);
    await expectRlsDenies(superuser, execA, 'outfits', USER_B);
  });

  // ---- delete (F6) — idempotent, tenant-scoped. Oracle = superuser row count. ----

  it('delete own outfit → { deleted: true }, and the row (with members) is gone', async () => {
    const item = await seedItem(execA, USER_A);
    const created = OutfitRow.parse(
      await (await callerA.call(createOutfit, { body: { name: 'ToGo', items: [{ item_id: item }] } })).json(),
    );
    const res = await callerA.call(deleteOutfit, { body: { id: created.id } });
    expect(res.status).toBe(200);
    expect((await res.json()) as { deleted: boolean }).toEqual({ deleted: true });
    // Independent oracle: the outfit AND its cascaded members are gone (superuser SELECT).
    const outfitCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [created.id],
    );
    expect(outfitCount.rows[0]?.n).toBe('0');
    const memberCount = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfit_items WHERE outfit_id = $1`,
      [created.id],
    );
    expect(memberCount.rows[0]?.n).toBe('0');
  });

  it('delete a missing id → { deleted: false }, 200 (idempotent, never 404)', async () => {
    const res = await callerA.call(deleteOutfit, {
      body: { id: 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { deleted: boolean }).toEqual({ deleted: false });
  });

  it("delete another tenant's outfit → { deleted: false }, and B's row survives", async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    const { rows } = await execB.query<{ id: string }>(
      `INSERT INTO public.outfits (user_id, name) VALUES ($1,'B-keep') RETURNING id`,
      [USER_B],
    );
    const bOutfitId = rows[0]!.id;
    const res = await callerA.call(deleteOutfit, { body: { id: bOutfitId } });
    expect(res.status).toBe(200);
    // A cannot tell whether it exists — a benign no-op — and B's row is untouched.
    expect((await res.json()) as { deleted: boolean }).toEqual({ deleted: false });
    const survives = await superuser.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.outfits WHERE id = $1`,
      [bOutfitId],
    );
    expect(survives.rows[0]?.n).toBe('1');
  });

  // The MOAT invariant: wear_log is append-only history. Deleting an outfit must NOT take
  // its wear rows with it — the outfit FK is ON DELETE SET NULL (0006), so the row survives
  // with outfit_id nulled. This is exactly the behaviour migration 0018's index backs; the
  // oracle is a superuser SELECT of the wear row after the delete, not the handler response.
  it('delete own outfit → its wear_log rows survive with outfit_id nulled (moat is append-only)', async () => {
    const item = await seedItem(execA, USER_A);
    const created = OutfitRow.parse(
      await (await callerA.call(createOutfit, { body: { name: 'Worn', items: [{ item_id: item }] } })).json(),
    );
    const { rows: wearRows } = await execA.query<{ id: string }>(
      `INSERT INTO public.wear_log (user_id, item_id, outfit_id, client_id)
       VALUES ($1, $2, $3, 'wear-tap-1') RETURNING id`,
      [USER_A, item, created.id],
    );
    const wearId = wearRows[0]!.id;

    const res = await callerA.call(deleteOutfit, { body: { id: created.id } });
    expect(res.status).toBe(200);
    expect((await res.json()) as { deleted: boolean }).toEqual({ deleted: true });

    // The wear row still exists (append-only), but its outfit_id was nulled, not deleted.
    const wear = await superuser.query<{ n: string; outfit_id: string | null }>(
      `SELECT count(*)::text AS n, max(outfit_id::text) AS outfit_id
         FROM public.wear_log WHERE id = $1`,
      [wearId],
    );
    expect(wear.rows[0]?.n).toBe('1');
    expect(wear.rows[0]?.outfit_id).toBeNull();
  });

  it('delete retry after success → { deleted: false } (idempotent, never 500)', async () => {
    const item = await seedItem(execA, USER_A);
    const created = OutfitRow.parse(
      await (await callerA.call(createOutfit, { body: { name: 'Twice', items: [{ item_id: item }] } })).json(),
    );
    const first = await callerA.call(deleteOutfit, { body: { id: created.id } });
    const retry = await callerA.call(deleteOutfit, { body: { id: created.id } });
    expect((await first.json()) as { deleted: boolean }).toEqual({ deleted: true });
    expect(retry.status).toBe(200);
    expect((await retry.json()) as { deleted: boolean }).toEqual({ deleted: false });
  });

  it('delete with a malformed body → 400 at the boundary', async () => {
    const res = await callerA.call(deleteOutfit, { body: { id: 'not-a-uuid' } });
    expect(res.status).toBe(400);
  });

  // ---- rename (F6) — returns the UPDATED row; a miss is 404 (asymmetric with delete). ----

  it('rename own outfit → 200 with the updated name', async () => {
    const item = await seedItem(execA, USER_A);
    const created = OutfitRow.parse(
      await (await callerA.call(createOutfit, { body: { name: 'Before', items: [{ item_id: item }] } })).json(),
    );
    const res = await callerA.call(renameOutfit, { body: { id: created.id, name: 'After' } });
    expect(res.status).toBe(200);
    const updated = OutfitRow.parse(await res.json());
    expect(updated.name).toBe('After');
    // Independent oracle: the persisted name changed (superuser SELECT, not the response).
    const persisted = await superuser.query<{ name: string | null }>(
      `SELECT name FROM public.outfits WHERE id = $1`,
      [created.id],
    );
    expect(persisted.rows[0]?.name).toBe('After');
  });

  it('rename a missing id → 404 not_found (unlike delete, no benign row to return)', async () => {
    const res = await callerA.call(renameOutfit, {
      body: { id: 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4', name: 'Ghost' },
    });
    expect(res.status).toBe(404);
  });

  it("rename another tenant's outfit → 404, and B's name is unchanged", async () => {
    const execB = makeTenantExecutor(pool, USER_B);
    const { rows } = await execB.query<{ id: string }>(
      `INSERT INTO public.outfits (user_id, name) VALUES ($1,'B-original') RETURNING id`,
      [USER_B],
    );
    const bOutfitId = rows[0]!.id;
    const res = await callerA.call(renameOutfit, { body: { id: bOutfitId, name: 'A-hijack' } });
    expect(res.status).toBe(404);
    // B's row is scoped out by the repo's WHERE user_id before RLS — name untouched.
    const persisted = await superuser.query<{ name: string | null }>(
      `SELECT name FROM public.outfits WHERE id = $1`,
      [bOutfitId],
    );
    expect(persisted.rows[0]?.name).toBe('B-original');
  });

  it('rename with a malformed body → 400 at the boundary', async () => {
    const res = await callerA.call(renameOutfit, { body: { id: 'not-a-uuid', name: 'x' } });
    expect(res.status).toBe(400);
  });
});
