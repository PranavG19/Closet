#!/bin/sh
# posttool-typecheck.sh — PostToolUse(Edit|Write) fast local signal. When an agent
# edits a TypeScript file, run an incremental scoped `tsc --build` on just that
# file's package and surface any type error seconds after the edit — instead of
# discovering it only at the Stop wall. Ported from fitapp. (agent-arch Rule 4.)
#
# ADVISORY, never blocks: PostToolUse output is informational. Clean → prints
# nothing (no noise). Failing → prints the tsc errors. Non-.ts/.tsx edits and files
# outside packages/* → silent no-op.
REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO" ] && exit 0

FILE="$(node -e "try{process.stdout.write((JSON.parse(process.env.CLAUDE_TOOL_INPUT||'{}').file_path)||'')}catch(e){process.stdout.write('')}" 2>/dev/null)"
[ -z "$FILE" ] && exit 0

case "$FILE" in
  *.ts|*.tsx) : ;;
  *) exit 0 ;;
esac

REL="${FILE#$REPO/}"
case "$REL" in
  packages/*) PKG="packages/$(printf '%s' "$REL" | cut -d/ -f2)" ;;
  *) exit 0 ;;
esac
[ -f "$REPO/$PKG/tsconfig.json" ] || exit 0

OUT="$(cd "$REPO" && pnpm -w exec tsc --build "$PKG" 2>&1)"
if [ $? -ne 0 ]; then
  printf 'tsc --build %s reported type errors after this edit (fast local signal; the full wall runs at Stop):\n%s\n' "$PKG" "$OUT"
fi
exit 0
