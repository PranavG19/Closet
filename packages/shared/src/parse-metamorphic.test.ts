// Tier-1 METAMORPHIC (docs/05) — provider-agnostic relations over the parse path's
// PURE fns: F4 phash near-duplicate dedupe (packages/shared/dedupe) and the CutoutPort
// idempotence relation modeled with a deterministic fake adapter we fully control.
//
// A metamorphic test asserts a RELATION between the outputs of RELATED inputs that must
// hold regardless of the true label — independence means the relation is a property of
// the world (the phash bit-distance, the cutout transform), not the author's guess at a
// category. No curated "correct answer" is computed here; fast-check searches the input
// space and the invariants bite any implementation that violates them. These relations
// outlive any specific vision/cutout vendor.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  PHASH_BITS,
  DEDUPE_HAMMING_THRESHOLD,
  parsePhash,
  hammingDistance,
  dedupeCompare,
  type Phash,
} from './dedupe.js';
import { CutoutResultSchema, type CutoutPort, type CutoutResult } from './ports/CutoutPort.js';
import { GarmentCategory } from './ports/AIVisionPort.js';
import { parseBoundary } from './parse.js';

// ---- shared arbitraries -------------------------------------------------------
// parsePhash's wire form is a DECIMAL bigint::text string (what the repos emit), not hex — see
// dedupe.ts. Mask to 64 bits so a value at/above 2^63 still maps to its canonical unsigned form.
const toPhash = (n: bigint): Phash => parsePhash((n & ((1n << 64n) - 1n)).toString(10));

const arbPhash: fc.Arbitrary<Phash> = fc
  .bigInt({ min: 0n, max: (1n << 64n) - 1n })
  .map(toPhash);

// A base phash plus a NESTED pair of bit-flip sets: applying the first `split`
// positions yields distance = split; applying all of them yields distance = k, with
// split <= k BY CONSTRUCTION (nested subset). This lets us assert monotonicity of the
// verdict in distance without ever computing the "true" answer — the two distances are
// ordered structurally, not by the code under test.
const arbNestedFlipPair = fc
  .tuple(
    arbPhash,
    fc.uniqueArray(fc.integer({ min: 0, max: 63 }), { minLength: 0, maxLength: 64 }),
    fc.integer({ min: 0, max: 64 }),
  )
  .map(([base, positions, rawSplit]) => {
    const split = Math.min(rawSplit, positions.length);
    const near = base as bigint;
    let nearBits = near;
    for (let i = 0; i < split; i += 1) nearBits ^= 1n << BigInt(positions[i]!);
    let farBits = near;
    for (const p of positions) farBits ^= 1n << BigInt(p);
    return {
      base,
      near: toPhash(nearBits), // distance === split
      far: toPhash(farBits), // distance === positions.length (>= split)
    };
  });

// A phash pair whose distance is concentrated AROUND the threshold boundary (flip
// counts in [T-3, T+3]), so the boundary-flip relation is exercised on both sides
// densely rather than by luck.
const arbBoundaryPair = fc
  .tuple(
    arbPhash,
    fc.integer({ min: Math.max(0, DEDUPE_HAMMING_THRESHOLD - 3), max: DEDUPE_HAMMING_THRESHOLD + 3 }),
  )
  .chain(([base, flipCount]) =>
    fc
      .uniqueArray(fc.integer({ min: 0, max: 63 }), { minLength: flipCount, maxLength: flipCount })
      .map((positions) => {
        let bits = base as bigint;
        for (const p of positions) bits ^= 1n << BigInt(p);
        return { base, other: toPhash(bits), distance: positions.length };
      }),
  );

// ---- Relation 3a: near-duplicate agreement (F4, no true label) ----------------
// Within-threshold ⇒ 'duplicate'; beyond ⇒ 'keep-both'. This is the boundary itself,
// asserted from the independent oracle of the ACTUAL bit distance, not a curated case.
describe('F4 near-duplicate: verdict tracks the true bit-distance across the threshold', () => {
  it('at/below threshold → duplicate; above → keep-both (boundary-concentrated)', () => {
    fc.assert(
      fc.property(arbBoundaryPair, ({ base, other, distance }) => {
        const expected = distance <= DEDUPE_HAMMING_THRESHOLD ? 'duplicate' : 'keep-both';
        expect(dedupeCompare(base, other)).toBe(expected);
      }),
    );
  });

  // METAMORPHIC monotonicity: increasing the distance (nested extra flips) can only move
  // a verdict from 'duplicate' toward 'keep-both', NEVER back. A dedupe that violated this
  // (e.g. a non-monotone hash comparison) would flag a MORE-different photo as the same
  // garment — the exact F4 failure this guards, provable without any labeled corpus.
  it('monotone in distance: keep-both at the nearer distance ⇒ keep-both at the farther', () => {
    fc.assert(
      fc.property(arbNestedFlipPair, ({ base, near, far }) => {
        // near is a subset-flip of far, so d(base,near) <= d(base,far) structurally.
        expect(hammingDistance(base, near)).toBeLessThanOrEqual(hammingDistance(base, far));
        if (dedupeCompare(base, near) === 'keep-both') {
          expect(dedupeCompare(base, far)).toBe('keep-both');
        }
      }),
    );
  });
});

// ---- Relation 3b: agreement is label-independent -------------------------------
// The dedupe verdict is a property of the two PHASHES alone. "Same garment" for the F4
// merge is (near-dup phash AND same category). The metamorphic independence claim: the
// phash verdict is INVARIANT to whatever category labels a vendor assigns — swapping the
// labels never changes whether two photos dedupe. This is why the signal survives a
// vendor swap: it does not depend on the vendor's category taxonomy at all.
function sameGarment(pa: Phash, ca: string, pb: Phash, cb: string): boolean {
  return dedupeCompare(pa, pb) === 'duplicate' && ca === cb;
}

const arbCategory = fc.constantFrom(...GarmentCategory.options);

describe('F4 same-garment agreement: symmetric and independent of the category taxonomy', () => {
  it('sameGarment is symmetric under swapping the two (phash, category) sides', () => {
    fc.assert(
      fc.property(arbPhash, arbCategory, arbPhash, arbCategory, (pa, ca, pb, cb) => {
        expect(sameGarment(pa, ca, pb, cb)).toBe(sameGarment(pb, cb, pa, ca));
      }),
    );
  });

  it('within-threshold + equal category ⇒ agree "same garment"', () => {
    fc.assert(
      fc.property(arbBoundaryPair, arbCategory, ({ base, other, distance }, cat) => {
        if (distance <= DEDUPE_HAMMING_THRESHOLD) {
          expect(sameGarment(base, cat, other, cat)).toBe(true);
        }
      }),
    );
  });

  it('the phash verdict itself is invariant to the category labels attached to it', () => {
    fc.assert(
      fc.property(arbPhash, arbPhash, arbCategory, arbCategory, (pa, pb, ca, cb) => {
        // sameGarment differs from the phash verdict ONLY via the category equality term,
        // never via the phashes — proven by holding phashes fixed while varying labels.
        const verdict = dedupeCompare(pa, pb);
        expect(sameGarment(pa, ca, pb, cb)).toBe(verdict === 'duplicate' && ca === cb);
      }),
    );
  });

  it('range sanity: the distance driving all of the above stays within [0, PHASH_BITS]', () => {
    fc.assert(
      fc.property(arbPhash, arbPhash, (a, b) => {
        const d = hammingDistance(a, b);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(PHASH_BITS);
      }),
    );
  });
});

// ---- Relation 4: cutout idempotence (near-identity on an already-cut input) ----
// A background-removal cutout is (up to tolerance) IDEMPOTENT: feeding a cutout back
// through the cutter must not keep shrinking geometry or drop the alpha channel — the
// second pass is a near-identity. We model the vendor with a deterministic fake we
// control: the first pass trims a fixed content margin and adds alpha; an already-alpha
// (already-cut) input is a no-op. The relation asserted (alpha stable, geometry stable
// within tolerance) is what any real cutout vendor MUST satisfy — a vendor that failed it
// would corrupt a re-processed garment.
interface CutImage {
  readonly width: number;
  readonly height: number;
  readonly alpha: boolean;
}

const CONTENT_KEEP = 0.92; // first pass trims ~8% background margin
const GEOMETRY_TOLERANCE = 0; // an idempotent second pass changes nothing here

function cut(img: CutImage): CutImage {
  if (img.alpha) return img; // already cut → identity (content already tight)
  return {
    width: Math.max(1, Math.round(img.width * CONTENT_KEEP)),
    height: Math.max(1, Math.round(img.height * CONTENT_KEEP)),
    alpha: true,
  };
}

// The same transform behind the real CutoutPort interface, with a registry so calling
// removeBackground on its OWN prior output url reproduces the already-cut (identity) path.
function makeIdempotentCutoutPort(): CutoutPort {
  const registry = new Map<string, CutImage>();
  return {
    async removeBackground({ imageUrl }): Promise<CutoutResult> {
      const input = registry.get(imageUrl) ?? { width: 1000, height: 1500, alpha: false };
      const output = cut(input);
      const outUrl = input.alpha ? imageUrl : `${imageUrl}.cutout.png`;
      registry.set(outUrl, output);
      return { imageUrl: outUrl, hasAlpha: output.alpha, width: output.width, height: output.height };
    },
  };
}

// Identity scope for the port calls below. The idempotence relation is a property of
// the cutout TRANSFORM, so both passes run under the SAME owner/job — varying them
// would change the composed path and stop testing idempotence.
const CUT_SCOPE = {
  userId: '33333333-3333-4333-8333-333333333333',
  parseJobId: '44444444-4444-4444-8444-444444444444',
} as const;

describe('CutoutPort idempotence: cut(cut(x)) is a near-identity of cut(x)', () => {
  it('pure relation: second pass preserves alpha and geometry within tolerance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8000 }),
        fc.integer({ min: 1, max: 8000 }),
        (width, height) => {
          const once = cut({ width, height, alpha: false });
          const twice = cut(once);
          expect(once.alpha).toBe(true);
          expect(twice.alpha).toBe(once.alpha); // alpha stable
          expect(Math.abs(twice.width - once.width)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
          expect(Math.abs(twice.height - once.height)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
        },
      ),
    );
  });

  it('through the real CutoutPort contract: re-cutting the port output is a no-op', async () => {
    const port = makeIdempotentCutoutPort();
    const first = parseBoundary(
      CutoutResultSchema,
      await port.removeBackground({ imageUrl: 'approved/original.jpg', ...CUT_SCOPE }),
      'cutout.first',
    );
    const second = parseBoundary(
      CutoutResultSchema,
      await port.removeBackground({ imageUrl: first.imageUrl, ...CUT_SCOPE }),
      'cutout.second',
    );
    expect(first.hasAlpha).toBe(true);
    expect(second.hasAlpha).toBe(first.hasAlpha); // alpha stable
    expect(second.width).toBe(first.width); // geometry transform-consistent
    expect(second.height).toBe(first.height);
    expect(second.imageUrl).toBe(first.imageUrl); // stable fixed point
  });
});
