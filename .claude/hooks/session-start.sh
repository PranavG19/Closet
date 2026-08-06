#!/bin/sh
# session-start.sh — SessionStart hook. Surfaces current build state to every agent
# at session start: the latest RUN-LOG lines (where the build is), open BUG-QUEUE
# ids (what's known-broken), and open escalation items (what's human-gated).
# Read-only; prints context to stdout. Ported from fitapp.

REPO="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

echo "=== closet-app session context ==="
echo ""
echo "--- latest RUN-LOG (last 5) ---"
tail -n 5 "$REPO/docs/RUN-LOG.md" 2>/dev/null || echo "(no RUN-LOG yet)"
echo ""
echo "--- BUG-QUEUE ids (open unless marked FIXED/RESOLVED) ---"
grep -Eo '^\- \*\*BQ-[0-9]+[^*]*' "$REPO/docs/BUG-QUEUE.md" 2>/dev/null | sed 's/^- \*\*/  /' || echo "(no BUG-QUEUE yet)"
echo ""
echo "Read-order: your task file → CLAUDE.md (the rules) → manifest.json (symbols)."
echo "Verify before ending: \`pnpm verify:full\`. Conventions SSOT: conventions.json (\`pnpm gen\`)."
echo "=== end context ==="
