#!/bin/sh
# db-guard.sh — PreToolUse(Bash) intercept. Blocks raw destructive SQL run ad-hoc
# through the shell (psql -c "DROP ...", supabase db ... with a DROP, heredoc'd
# TRUNCATE). Destructive DDL is an escalation trigger (irreversible op — CLAUDE.md
# rule 6 / AGENTS.md STOP list); it belongs ONLY in a numbered migration under
# packages/db/migrations/ with a matching approvals/<name>.approved token, never
# typed into a terminal against a live DB. Ported from fitapp.
#
# Heuristic: fires only when the command BOTH (a) invokes a DB client verb AND
# (b) carries a destructive keyword. A DROP inside a .sql migration file is NOT seen
# by this hook (it inspects shell commands, not file contents). Exit 0 always; a
# block is a PreToolUse hookSpecificOutput JSON with permissionDecision:"deny".

CMD="$(node -e "try{process.stdout.write((JSON.parse(process.env.CLAUDE_TOOL_INPUT||'{}').command)||'')}catch(e){process.stdout.write('')}")"

allow() { exit 0; }
block() { node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:process.argv[1]}}))" -- "$1"; exit 0; }

# (a) does the command invoke a DB client that can execute SQL against a live DB?
printf '%s' "$CMD" | grep -Eq '(^|[[:space:];&|])(psql|pg_restore)([[:space:]]|$)|supabase[[:space:]]+db[[:space:]]|docker[[:space:]]+exec[^|]*psql' || allow

# (b) does it carry destructive DDL?
if printf '%s' "$CMD" | grep -Eiq '\b(DROP[[:space:]]+(TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE|DROP[[:space:]]+OWNED)\b'; then
  block "Raw destructive SQL via shell blocked (db-guard). Destructive DDL is an irreversible-op escalation: it must land in a numbered migration under packages/db/migrations/ with a matching approvals/<name>.approved token, never run ad-hoc against a live DB. For test-container teardown use the container lifecycle (afterAll/stop), not a shell DROP."
fi

allow
