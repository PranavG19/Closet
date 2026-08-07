#!/usr/bin/env node
// bench-scan-build-corpus.mjs — the corpus/baseline builder + generation-drift gate for
// the bench-scan oracle (docs/05). It DERIVES the committed fixtures from the human-owned
// source of truth so the baseline provably reflects the real held corpus:
//
//   source/corpus.json   (HUMAN-OWNED)  = { images[], labels[], floors }
//        │  images = upstream corpus image metadata (id, width, height, sha256) — the
//        │           "generation" the baseline is pinned to.
//        │  labels = EXTERNAL truth (NOT pipeline output) — the anti-mirror premise.
//        │  floors = human-set quality bar that straddles honest (above) / adversary (below).
//        ▼
//   labels.json          (DERIVED)  = the held corpus columns the scorer joins on.
//   baseline.json        (DERIVED)  = { floors, replay: <pinned honest score surface>,
//                                       sourceFingerprint: <hash of images metadata> }.
//
// MODES:
//   (no flag)   (re)generate labels.json + baseline.json from source/corpus.json, running
//               the honest recordings through the same scoreRun to PIN the replay surface.
//   --check     no-op that exits 0 when the committed fixtures match what would be
//               regenerated, and NON-ZERO naming the drift when the source image set (or
//               labels/floors) changed but the fixtures were not regenerated. This is the
//               generation-drift gate (mirrors gen-conventions.mjs --check): it guarantees
//               the committed baseline reflects the real source images, so a silent corpus
//               swap cannot ride in behind a stale-but-green baseline.
//
// Determinism: the fingerprint + pinned surface use only source content (no clock/random),
// and reuse scoreRun + the stable serializer from bench-scan.mjs so the pinned bytes are
// exactly what the replay tier will byte-compare against. NO DB, NO Postgres, NO network.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AIVisionResultSchema, CutoutResultSchema, parseBoundary } from "../packages/shared/dist/index.js";
import { scoreRun } from "./bench-scan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "bench-scan-fixtures");
const SOURCE = join(FIXTURES, "source", "corpus.json");

const V = AIVisionResultSchema.shape;
const ASPECT_BUCKET = z.enum(["portrait", "landscape", "square"]);

const CorpusSchema = z.object({
  images: z.array(z.object({
    id: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sha256: z.string().min(1),
  })),
  labels: z.array(z.object({
    id: z.string().min(1),
    category: V.category,
    primaryColor: V.primaryColor,
    pattern: V.pattern,
    formality: V.formality,
    season: V.season,
    material: V.material,
    cutout: z.object({ hasAlpha: z.boolean(), aspectRatioBucket: ASPECT_BUCKET }),
  })),
  floors: z.object({
    category: z.number(), primaryColor: z.number(), pattern: z.number(),
    formality: z.number(), season: z.number(), cutout: z.number(), aggregate: z.number(),
  }),
});

const RecordingSchema = z.object({
  id: z.string().min(1),
  vision: AIVisionResultSchema,
  cutout: CutoutResultSchema,
});

// Stable serializer identical to bench-scan.mjs's (sorted keys, arrays in given order) so
// the pinned surface is byte-for-byte what the replay tier recomputes and compares.
function stableStringify(value, indent = 2, depth = 0) {
  const pad = " ".repeat(indent * (depth + 1));
  const padEnd = " ".repeat(indent * depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => pad + stableStringify(v, indent, depth + 1)).join(",\n")}\n${padEnd}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    return `{\n${keys.map((k) => `${pad}${JSON.stringify(k)}: ${stableStringify(value[k], indent, depth + 1)}`).join(",\n")}\n${padEnd}}`;
  }
  return JSON.stringify(value);
}

// Fingerprint of the upstream image "generation": sha256 over the sorted image metadata.
// If the held image set changes (added/removed/resized/re-hashed) this changes, and --check
// goes red until the baseline is regenerated against the new generation.
function fingerprintImages(images) {
  const sorted = [...images].sort((a, b) => a.id.localeCompare(b.id));
  const canon = sorted.map((i) => `${i.id}:${i.width}x${i.height}:${i.sha256}`).join("|");
  return createHash("sha256").update(canon).digest("hex");
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadHonestRecordings() {
  const dir = join(FIXTURES, "recordings", "honest");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => parseBoundary(RecordingSchema, loadJson(join(dir, f)), `recordings/honest/${f}`));
}

// Derive the two fixture files from source. Pure w.r.t. wall clock — same source → same bytes.
function derive(corpus) {
  const labels = [...corpus.labels].sort((a, b) => a.id.localeCompare(b.id));
  const honest = loadHonestRecordings();
  // The replay tier scores honest vs labels; PIN exactly that surface so drift is byte-detectable.
  const replay = scoreRun(honest, labels);
  const baseline = {
    floors: corpus.floors,
    replay,
    sourceFingerprint: fingerprintImages(corpus.images),
  };
  return {
    labelsText: stableStringify(labels) + "\n",
    baselineText: stableStringify(baseline) + "\n",
  };
}

function main() {
  const check = process.argv.includes("--check");
  const corpus = parseBoundary(CorpusSchema, loadJson(SOURCE), "source/corpus.json");
  const { labelsText, baselineText } = derive(corpus);
  const labelsPath = join(FIXTURES, "labels.json");
  const baselinePath = join(FIXTURES, "baseline.json");

  if (!check) {
    writeFileSync(labelsPath, labelsText);
    writeFileSync(baselinePath, baselineText);
    process.stderr.write(`✓ regenerated labels.json + baseline.json from source/corpus.json (${corpus.labels.length} labels, fingerprint ${fingerprintImages(corpus.images).slice(0, 12)}).\n`);
    process.exit(0);
  }

  // --check: compare committed bytes to freshly-derived bytes; name the drift, don't rewrite.
  const drift = [];
  const readOr = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  const committedLabels = readOr(labelsPath);
  const committedBaseline = readOr(baselinePath);
  if (committedLabels !== labelsText) drift.push("labels.json (source labels changed or fixtures stale)");
  if (committedBaseline !== baselineText) {
    const committed = committedBaseline ? parseBoundary(z.object({ sourceFingerprint: z.string() }).passthrough(), JSON.parse(committedBaseline)) : null;
    const fresh = fingerprintImages(corpus.images);
    if (committed && committed.sourceFingerprint !== fresh) {
      drift.push(`baseline.json sourceFingerprint (committed ${committed.sourceFingerprint.slice(0, 12)} ≠ source ${fresh.slice(0, 12)} — the held image set changed but fixtures were not regenerated)`);
    } else {
      drift.push("baseline.json (floors or pinned replay surface differ from source — regenerate)");
    }
  }
  if (drift.length > 0) {
    process.stderr.write(`✗ generation-drift: committed fixtures are STALE vs source/corpus.json:\n  - ${drift.join("\n  - ")}\n  → run \`node scripts/bench-scan-build-corpus.mjs\` and commit.\n`);
    process.exit(1);
  }
  process.stderr.write("✓ generation-drift check: committed fixtures match source/corpus.json (fresh).\n");
  process.exit(0);
}

main();
