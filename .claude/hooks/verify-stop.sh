#!/bin/sh
# verify-stop.sh — Stop hook (highest-value). MECHANICALLY proves the full verify
# wall ran against the current tree before the agent ends its turn — instead of
# trusting the agent's claim "I verified." (agent-arch Rule 3.) Ported from fitapp.
#
# How: `pnpm verify:full` writes .git/verify-stamp = a hash of (HEAD + working diff
# + untracked contents) on success. This hook recomputes that hash via the SHARED
# scripts/worktree-hash.sh; if it does NOT match the stamp, tracked files changed
# since verify last passed (or verify never ran) → block the Stop and tell the agent
# to run `pnpm verify:full`.
#
# Lenient by design: clean tree (nothing changed vs HEAD) → allow; git unavailable
# → allow (can't prove staleness). Emit hook JSON on stdout; exit 0. To ALLOW emit
# {continue:true}; to BLOCK {decision:"block",reason}.

REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO" ] && { node -e "process.stdout.write(JSON.stringify({continue:true}))"; exit 0; }

allow() { node -e "process.stdout.write(JSON.stringify({continue:true}))"; exit 0; }
block() { node -e "process.stdout.write(JSON.stringify({decision:'block',reason:process.argv[1]}))" "$1"; exit 0; }

STAMP_FILE="$REPO/.git/verify-stamp"

CUR="$(sh "$REPO/scripts/worktree-hash.sh" "$REPO" 2>/dev/null)"
STATUS="$(git -C "$REPO" --no-optional-locks status --porcelain=v1 2>/dev/null)"
DIFF="$(git -C "$REPO" --no-optional-locks diff HEAD 2>/dev/null)"

# Clean tree → nothing to verify.
if [ -z "$STATUS" ] && [ -z "$DIFF" ]; then allow; fi

if [ ! -f "$STAMP_FILE" ]; then
  block "Uncommitted changes present but the full verify wall has not run this session. Run \`pnpm verify:full\` and address any failure before ending. On success a verify-stamp is written and Stop is allowed."
fi

STAMP="$(cat "$STAMP_FILE" 2>/dev/null | tr -d '[:space:]')"
if [ "$CUR" != "$STAMP" ]; then
  block "Tracked files changed since \`pnpm verify:full\` last passed (verify-stamp is stale). Re-run \`pnpm verify:full\` against the current tree before ending — this hook exists so 'verified' is proven mechanically, not asserted."
fi

allow
