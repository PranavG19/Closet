#!/usr/bin/env node
// bench-scan.mjs — the parse-quality oracle (docs/05 Tier-1 "Bench-scan differential
// corpus"). This script IS the oracle: it scores pipeline output (AIVisionResult /
// CutoutResult recordings) against a HELD CORPUS whose labels were NOT produced by the
// pipeline (external truth, see bench-scan-fixtures/README.md). Three tiers, each
// escaping the author's reach a different way:
//
//   --tier=replay       (default, KEYLESS) score committed honest recordings vs labels;
//                       emit byte-deterministic --json and byte-compare it to the pinned
//                       surface in baseline.json. A scoring-logic change or baseline drift
//                       is LOUD. Runs in verify:full on every merge.
//   --tier=adversary    score the deliberately-WRONG recordings through the identical
//                       scorer; assert aggregate collapses strictly below the floor.
//                       Exits 0 when the bad model fails (the gate working) and NON-ZERO
//                       if the adversary passes or the floor is 0 ("gate dead"). Nightly.
//   --tier=differential score two recording sets (--a / --b) on the identical corpus and
//                       report per-attribute deltas (a-b); --gate makes side A's floor a
//                       hard gate. The objective basis for an AIVisionPort swap. Nightly.
//   --tier=live         placeholder for a real-provider run; reads its key via envValue
//                       and reports "skipped" (exit 0) when absent so keyless CI is never
//                       blocked. No live adapter is wired in this task.
//
// GATE-LIVENESS (proven red->green, docs/05 §(b)): the adversary tier was demonstrated
// able to FAIL — replacing the adversary recordings with correct ones (or setting the
// aggregate floor to 0) drives it non-zero with "adversary passed — gate dead"; restoring
// them returns it green. A gate that cannot go red is not a gate. See README §"gate bites".
//
// Determinism is the whole product of the replay tier: NO Date.now / Math.random / wall
// clock anywhere in the scoring path; all emitted numbers are rounded to 4 decimals and
// keys are emitted in a stable recursive order, so a byte diff (not self-confidence)
// catches a regression.
//
// Layer: standalone Node ESM under scripts/ (sibling to verify.mjs / gates/*.mjs). NO DB,
// NO Postgres, NO repo/handler/migration, NO supabase. Imports only the real port result
// contracts from @closet/shared's built dist (produced by `tsc --build`, which verify:full
// runs before this tier) + zod for the corpus/baseline schemas defined here.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AIVisionResultSchema,
  CutoutResultSchema,
  parseBoundary,
} from "../packages/shared/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = join(HERE, "bench-scan-fixtures");

// ── envValue — the ONLY sanctioned config read (CLAUDE.md: never bare process.env).
// Mirrors packages/functions/src/auth/env.ts (Deno.env.get ?? process.env) so the same
// helper works if this ever runs under Deno; the functions dist is not built keyless so
// the tiny helper is inlined rather than imported. The replay + adversary tiers read NO
// secret by construction — only the live/differential-against-a-real-adapter path does.
function envValue(key) {
  const fromDeno = globalThis.Deno?.env?.get?.(key);
  if (fromDeno !== undefined) return fromDeno;
  return globalThis.process?.env?.[key];
}

// ── Corpus + baseline schemas (parse-don't-cast: every fixture crosses a boundary). The
// scored attribute columns REUSE the real port field schemas (AIVisionResultSchema.shape)
// so a label can never carry a value the port itself would reject.
const V = AIVisionResultSchema.shape;
const ASPECT_BUCKET = z.enum(["portrait", "landscape", "square"]);

const LabelSchema = z.object({
  id: z.string().min(1),
  category: V.category,
  primaryColor: V.primaryColor,
  pattern: V.pattern,
  formality: V.formality,
  season: V.season,
  material: V.material,
  // cutout reference: a committed, byte-comparable numeric summary (alpha + aspect bucket),
  // NOT a pixel mask. Pixel-IoU-over-reference-cutouts is a nightly live extension (README).
  cutout: z.object({ hasAlpha: z.boolean(), aspectRatioBucket: ASPECT_BUCKET }),
});

const RecordingSchema = z.object({
  id: z.string().min(1),
  vision: AIVisionResultSchema,
  cutout: CutoutResultSchema,
});

const FloorsSchema = z.object({
  category: z.number(),
  primaryColor: z.number(),
  pattern: z.number(),
  formality: z.number(),
  season: z.number(),
  cutout: z.number(),
  aggregate: z.number(),
});

const ScoreSurfaceSchema = z.object({
  n: z.number().int(),
  aggregate: z.number(),
  perAttribute: z.object({
    category: z.number(),
    primaryColor: z.number(),
    pattern: z.number(),
    formality: z.number(),
    season: z.number(),
    cutout: z.number(),
  }),
  misses: z.array(
    z.object({
      id: z.string(),
      attribute: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  ),
});

const BaselineSchema = z.object({
  floors: FloorsSchema,
  replay: ScoreSurfaceSchema,
  sourceFingerprint: z.string(),
});

// The attributes scored, in fixed order (drives perAttribute key order + aggregate mean).
const ATTRIBUTES = ["category", "primaryColor", "pattern", "formality", "season", "cutout"];

// ── Color-bucket comparison. WHY: primaryColor is a free hex; raw hex equality would score
// every near-shade (#fefefe vs #ffffff) as a miss and make the color column meaningless.
// We bucket each hex to its nearest documented palette anchor (squared-RGB distance) and
// compare buckets — perceptually-equal colors match, genuinely-different ones don't. The
// palette is fixed + committed so the mapping is deterministic and reviewable.
const COLOR_ANCHORS = {
  white: "#ffffff",
  black: "#000000",
  gray: "#808080",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  brown: "#8b4513",
  pink: "#ffc0cb",
  purple: "#800080",
  orange: "#ffa500",
};

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function colorBucket(hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = "";
  let bestDist = Infinity;
  // Object.entries order is insertion order for string keys → deterministic tie-break.
  for (const [name, anchor] of Object.entries(COLOR_ANCHORS)) {
    const [ar, ag, ab] = hexToRgb(anchor);
    const dist = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

// Aspect bucket from a cutout's committed integer dims — the byte-comparable geometry
// summary the label references. Fixed thresholds; no float in the emitted surface.
function aspectBucket(width, height) {
  const ratio = width / height;
  if (ratio < 0.9) return "portrait";
  if (ratio > 1.1) return "landscape";
  return "square";
}

// Round to 4 decimals so every emitted fraction has a short, stable JSON representation
// (byte-determinism). Pure arithmetic — no clock, no random.
function round4(x) {
  return Math.round(x * 1e4) / 1e4;
}

// Recursive stable stringify: object keys sorted, arrays kept in given order (callers sort
// arrays deterministically before this). Guarantees byte-identical output for equal values
// regardless of key insertion order.
function stableStringify(value, indent = 2, depth = 0) {
  const pad = " ".repeat(indent * (depth + 1));
  const padEnd = " ".repeat(indent * depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => pad + stableStringify(v, indent, depth + 1));
    return `[\n${items.join(",\n")}\n${padEnd}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    const items = keys.map((k) => `${pad}${JSON.stringify(k)}: ${stableStringify(value[k], indent, depth + 1)}`);
    return `{\n${items.join(",\n")}\n${padEnd}}`;
  }
  return JSON.stringify(value);
}

// ── scoreRun — the PURE, deterministic core shared by all tiers. Takes already-parsed
// arrays (NO I/O). Same inputs → byte-identical output. A recording with no matching label
// (or a label with no recording) is a HARD ERROR — coverage drift must be loud, never a
// silently smaller n.
export function scoreRun(recordings, labels) {
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const recById = new Map(recordings.map((r) => [r.id, r]));
  if (labelById.size !== labels.length) {
    throw new Error("scoreRun: duplicate label id(s)");
  }
  if (recById.size !== recordings.length) {
    throw new Error("scoreRun: duplicate recording id(s)");
  }
  const missingRecordings = [...labelById.keys()].filter((id) => !recById.has(id)).sort();
  const missingLabels = [...recById.keys()].filter((id) => !labelById.has(id)).sort();
  if (missingRecordings.length > 0 || missingLabels.length > 0) {
    const parts = [];
    if (missingRecordings.length > 0) parts.push(`label(s) with no recording: ${missingRecordings.join(", ")}`);
    if (missingLabels.length > 0) parts.push(`recording(s) with no label: ${missingLabels.join(", ")}`);
    throw new Error(`scoreRun: coverage drift — ${parts.join("; ")}`);
  }

  const ids = [...labelById.keys()].sort();
  const hits = Object.fromEntries(ATTRIBUTES.map((a) => [a, 0]));
  const misses = [];

  for (const id of ids) {
    const label = labelById.get(id);
    const rec = recById.get(id);
    // Compared tokens per attribute: exact enum match for category/pattern/formality/season;
    // bucketed comparison for primaryColor and cutout geometry (documented above).
    const expected = {
      category: label.category,
      primaryColor: colorBucket(label.primaryColor),
      pattern: label.pattern,
      formality: label.formality,
      season: label.season,
      cutout: `${label.cutout.aspectRatioBucket}/${label.cutout.hasAlpha}`,
    };
    const actual = {
      category: rec.vision.category,
      primaryColor: colorBucket(rec.vision.primaryColor),
      pattern: rec.vision.pattern,
      formality: rec.vision.formality,
      season: rec.vision.season,
      cutout: `${aspectBucket(rec.cutout.width, rec.cutout.height)}/${rec.cutout.hasAlpha}`,
    };
    for (const attr of ATTRIBUTES) {
      if (expected[attr] === actual[attr]) {
        hits[attr] += 1;
      } else {
        misses.push({ id, attribute: attr, expected: expected[attr], actual: actual[attr] });
      }
    }
  }

  const n = ids.length;
  const perAttribute = Object.fromEntries(ATTRIBUTES.map((a) => [a, round4(hits[a] / n)]));
  // aggregate = equal-weight mean of the per-attribute accuracies (each attribute counts
  // once, so no single high-cardinality column dominates the gate).
  const aggregate = round4(ATTRIBUTES.reduce((s, a) => s + hits[a] / n, 0) / ATTRIBUTES.length);
  // misses already appended in (id, attribute) order because we iterate sorted ids then the
  // fixed ATTRIBUTES order — deterministic without a further sort.
  return { n, aggregate, perAttribute, misses };
}

// ── fixture loading (I/O lives OUTSIDE scoreRun) ────────────────────────────────────────
function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadLabels(fixturesDir) {
  const raw = loadJson(join(fixturesDir, "labels.json"));
  if (!Array.isArray(raw)) throw new Error("labels.json is not an array");
  return raw.map((row, i) => parseBoundary(LabelSchema, row, `labels.json[${i}]`));
}

function loadRecordings(fixturesDir, kind) {
  const dir = join(fixturesDir, "recordings", kind);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`no recordings in recordings/${kind}`);
  return files.map((f) => parseBoundary(RecordingSchema, loadJson(join(dir, f)), `recordings/${kind}/${f}`));
}

function loadBaseline(fixturesDir) {
  return parseBoundary(BaselineSchema, loadJson(join(fixturesDir, "baseline.json")), "baseline.json");
}

// Which per-attribute + aggregate scores clear their floors. Returns { pass, offenders }.
function floorVerdict(surface, floors) {
  const offenders = [];
  for (const attr of ATTRIBUTES) {
    if (surface.perAttribute[attr] < floors[attr]) {
      offenders.push(`${attr} (${surface.perAttribute[attr]} < ${floors[attr]})`);
    }
  }
  if (surface.aggregate < floors.aggregate) {
    offenders.push(`aggregate (${surface.aggregate} < ${floors.aggregate})`);
  }
  return { pass: offenders.length === 0, offenders };
}

// ── tiers ───────────────────────────────────────────────────────────────────────────────
function runReplay(fixturesDir, emitJson) {
  const labels = loadLabels(fixturesDir);
  const honest = loadRecordings(fixturesDir, "honest");
  const baseline = loadBaseline(fixturesDir);
  const surface = scoreRun(honest, labels);

  // Byte-compare the computed surface to the pinned baseline surface. A scoring-logic change
  // or a baseline drift is caught HERE by a byte diff no self-confidence can hide.
  const computed = stableStringify(surface);
  const pinned = stableStringify(baseline.replay);
  if (computed !== pinned) {
    process.stderr.write("✗ replay: score surface DRIFTED from baseline.json (scoring logic changed or baseline stale).\n");
    process.stderr.write("  computed:\n" + computed + "\n");
    process.stderr.write("  pinned (baseline.replay):\n" + pinned + "\n");
    return { code: 1, surface };
  }

  const { pass, offenders } = floorVerdict(surface, baseline.floors);
  if (!pass) {
    process.stderr.write(`✗ replay: below floor — ${offenders.join("; ")}\n`);
    if (emitJson) process.stdout.write(computed + "\n");
    return { code: 1, surface };
  }

  process.stderr.write(`✓ replay: honest recordings clear every floor (aggregate ${surface.aggregate} ≥ ${baseline.floors.aggregate}), surface matches baseline.\n`);
  if (emitJson) process.stdout.write(computed + "\n");
  return { code: 0, surface };
}

function runAdversary(fixturesDir, emitJson) {
  const labels = loadLabels(fixturesDir);
  const adversary = loadRecordings(fixturesDir, "adversary");
  const baseline = loadBaseline(fixturesDir);
  const surface = scoreRun(adversary, labels);
  const floor = baseline.floors.aggregate;

  if (emitJson) process.stdout.write(stableStringify(surface) + "\n");

  // Guard the guard: a 0 floor cannot discriminate, so the tier itself must fail.
  if (floor <= 0) {
    process.stderr.write(`✗ adversary: aggregate floor is ${floor} — a 0/negative floor discriminates nothing. Gate dead.\n`);
    return { code: 1, surface };
  }
  // The whole point: a well-formed but wrong model must land BELOW the floor.
  if (surface.aggregate >= floor) {
    process.stderr.write(`✗ adversary PASSED the floor (aggregate ${surface.aggregate} ≥ ${floor}) — the floor does not discriminate. Gate dead.\n`);
    return { code: 1, surface };
  }
  process.stderr.write(`✓ adversary: aggregate ${surface.aggregate} collapses strictly below floor ${floor} — the gate correctly rejects the bad model.\n`);
  return { code: 0, surface };
}

function runDifferential(fixturesDir, aDir, bDir, gate, emitJson) {
  if (!aDir || !bDir) {
    process.stderr.write("✗ differential: --a=<recordingsDir> and --b=<recordingsDir> are required.\n");
    return { code: 2 };
  }
  const labels = loadLabels(fixturesDir);
  const loadDir = (d) => {
    const files = readdirSync(d).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) throw new Error(`no recordings in ${d}`);
    return files.map((f) => parseBoundary(RecordingSchema, loadJson(join(d, f)), `${d}/${f}`));
  };
  const baseline = loadBaseline(fixturesDir);
  const surfaceA = scoreRun(loadDir(aDir), labels);
  const surfaceB = scoreRun(loadDir(bDir), labels);

  const deltas = Object.fromEntries(ATTRIBUTES.map((a) => [a, round4(surfaceA.perAttribute[a] - surfaceB.perAttribute[a])]));
  deltas.aggregate = round4(surfaceA.aggregate - surfaceB.aggregate);
  const verdictA = floorVerdict(surfaceA, baseline.floors);
  const verdictB = floorVerdict(surfaceB, baseline.floors);

  const report = {
    a: { aggregate: surfaceA.aggregate, perAttribute: surfaceA.perAttribute, clearsFloor: verdictA.pass },
    b: { aggregate: surfaceB.aggregate, perAttribute: surfaceB.perAttribute, clearsFloor: verdictB.pass },
    deltas,
  };
  if (emitJson) process.stdout.write(stableStringify(report) + "\n");
  process.stderr.write(`differential: A aggregate ${surfaceA.aggregate} (clears floor: ${verdictA.pass}), B aggregate ${surfaceB.aggregate} (clears floor: ${verdictB.pass}); Δaggregate(a-b) ${deltas.aggregate}\n`);
  for (const attr of ATTRIBUTES) {
    process.stderr.write(`  Δ${attr}: ${deltas[attr]} (a ${surfaceA.perAttribute[attr]} / b ${surfaceB.perAttribute[attr]})\n`);
  }

  // Report by default (exit 0); with --gate, side A (the candidate) must clear its floor.
  if (gate && !verdictA.pass) {
    process.stderr.write(`✗ differential --gate: side A fails its floor — ${verdictA.offenders.join("; ")}\n`);
    return { code: 1 };
  }
  return { code: 0 };
}

function runLive(emitJson) {
  // Live provider run reads its key ONLY via envValue and degrades to "skipped" (exit 0)
  // when absent so CI's keyless replay tier is never blocked by a missing secret. No live
  // adapter is wired in this task (nightly extension) — even with a key we report skipped.
  const key = envValue("AI_VISION_API_KEY");
  const surface = { tier: "live", skipped: true, reason: key ? "no live adapter wired in this task (nightly)" : "no AI_VISION_API_KEY in env" };
  if (emitJson) process.stdout.write(stableStringify(surface) + "\n");
  process.stderr.write(`• live: skipped — ${surface.reason} (exit 0; keyless CI is never blocked).\n`);
  return { code: 0 };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = { tier: "replay", json: false, gate: false, fixtures: DEFAULT_FIXTURES, a: undefined, b: undefined };
  for (const arg of argv) {
    if (arg === "--json") flags.json = true;
    else if (arg === "--gate") flags.gate = true;
    else if (arg === "--differential") flags.tier = "differential";
    else if (arg.startsWith("--tier=")) flags.tier = arg.slice("--tier=".length);
    else if (arg.startsWith("--fixtures=")) flags.fixtures = arg.slice("--fixtures=".length);
    else if (arg.startsWith("--a=")) flags.a = arg.slice("--a=".length);
    else if (arg.startsWith("--b=")) flags.b = arg.slice("--b=".length);
  }
  return flags;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const run = () => {
    if (flags.tier === "replay") return runReplay(flags.fixtures, flags.json);
    if (flags.tier === "adversary") return runAdversary(flags.fixtures, flags.json);
    if (flags.tier === "differential") return runDifferential(flags.fixtures, flags.a, flags.b, flags.gate, flags.json);
    if (flags.tier === "live") return runLive(flags.json);
    process.stderr.write(`unknown --tier=${flags.tier} (expected replay|adversary|differential|live)\n`);
    return { code: 2 };
  };
  try {
    process.exit(run().code);
  } catch (error) {
    // A malformed fixture (parseBoundary reject) or coverage drift lands here: fail loudly,
    // never partially score bad data.
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`✗ bench-scan error: ${msg}\n`);
    process.exit(1);
  }
}

// Run the CLI only when invoked directly; when imported (e.g. by the corpus builder to
// reuse the pure scoreRun) do nothing so importing does not trigger a scored run + exit.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
