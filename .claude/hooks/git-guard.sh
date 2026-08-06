#!/bin/sh
# git-guard.sh — PreToolUse(Bash) intercept. Reads the tool input JSON on stdin
# (Claude Code also passes CLAUDE_TOOL_INPUT in env) and blocks dangerous git
# invocations by emitting a decision JSON. Ported from fitapp.
#
# Blocks: force-push, direct push to the default branch, --no-verify commits,
# staging obvious secrets. Everything else proceeds via the normal permission flow
# (empty stdout, exit 0). A block is a PreToolUse hookSpecificOutput JSON with
# permissionDecision:"deny" on stdout; the pass-through emits NO JSON (a guard must
# only ever deny — "allow" would auto-approve and bypass the allowlist).
#
# Fire-drill: echo '{"command":"git push --force"}' | CLAUDE_TOOL_INPUT='{"command":"git push --force"}' sh .claude/hooks/git-guard.sh

CMD="$(node -e "try{process.stdout.write((JSON.parse(process.env.CLAUDE_TOOL_INPUT||'{}').command)||'')}catch(e){process.stdout.write('')}")"

block() {
  node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:process.argv[1]}}))" -- "$1"
  exit 0
}

if printf '%s' "$CMD" | grep -Eq 'git[[:space:]]+push[[:space:]]+.*(--force|-f\b|--force-with-lease)'; then
  block "Force-push blocked by .claude/hooks/git-guard.sh"
fi
if printf '%s' "$CMD" | grep -Eq 'git[[:space:]]+push[[:space:]]+(origin[[:space:]]+)?(main|master)\b'; then
  block "Direct push to default branch blocked by git-guard.sh"
fi
if printf '%s' "$CMD" | grep -Eq 'git[[:space:]]+commit[[:space:]]+.*(-n|--no-verify)'; then
  block "--no-verify blocked — pre-commit hooks must run (git-guard.sh)"
fi
if printf '%s' "$CMD" | grep -Eq 'git[[:space:]]+add[[:space:]]+.*(\.env|\*\.pem|_authToken|service.role.key)'; then
  block "Staging secrets blocked by git-guard.sh"
fi

# No opinion → emit nothing and exit 0 so the command proceeds via the normal
# permission flow. A guard must only ever deny, never auto-allow.
exit 0
