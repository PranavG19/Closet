#!/bin/sh
# secret-file-guard.sh — PreToolUse intercept. Blocks an agent from READING the
# CONTENTS of a gitignored secret env file (.env, .env.migrate, .env.local, any
# .env.*) into its context/transcript, while still allowing it to be SOURCED into
# the environment (`. .env.migrate`, `set -a; source`) and WRITTEN (`> .env.migrate`).
# Ported from fitapp.
#
# WHY: an operator drops a real DATABASE_URL / API key into a gitignored `.env.*`
# so a tool call can source it WITHOUT the value entering the model's context. That
# property only holds if the agent cannot then cat/grep/od the file and echo the
# secret into its transcript. This guard is the mechanical form of "an agent may USE
# the secret (import the variable) but never READ its value."
#
# HONESTY (do not oversell): this blocks the CASUAL/ACCIDENTAL read (cat/head/sed/
# grep/xxd/…) that would leak a secret into the transcript. It is NOT an airtight
# sandbox — anything that can source the file can also exfiltrate by other means.
# It raises the bar and prevents the common accidental leak. The real protection is
# that the file is gitignored (never committed) and deleted after use.
#
# COVERS TWO TOOLS via two wirings in .claude/settings.json (matcher "Bash" inspects
# the command string; matcher "Read" inspects file_path — the Read tool would
# otherwise dump the file straight into context). Exit 0 always; a block is a
# PreToolUse hookSpecificOutput JSON with permissionDecision:"deny".

allow() { exit 0; }
block() {
  node -e "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:process.argv[1]}}))" -- "$1"
  exit 0
}

REASON="Reading the CONTENTS of a gitignored secret env file (.env / .env.migrate / .env.*) is blocked by .claude/hooks/secret-file-guard.sh. An agent MAY USE the secret by SOURCING it into the environment (e.g. \`set -a; . .env.migrate; set +a; pnpm db:migrate\`) so a command can consume \$DATABASE_URL — but it must NEVER cat/head/tail/sed/awk/grep/od/xxd/strings the file, which would echo the secret value into the transcript. Source it, use the variable, don't read it."

CMD="$(node -e "try{process.stdout.write((JSON.parse(process.env.CLAUDE_TOOL_INPUT||'{}').command)||'')}catch(e){process.stdout.write('')}")"
FILE_PATH="$(node -e "try{process.stdout.write((JSON.parse(process.env.CLAUDE_TOOL_INPUT||'{}').file_path)||'')}catch(e){process.stdout.write('')}")"

# --- Read tool branch: block Read on any .env secret file (never .env.example) ---
if [ -n "$FILE_PATH" ]; then
  if printf '%s' "$FILE_PATH" | grep -Eq '(^|/)\.env(\.[A-Za-z0-9_.-]+)?$' \
     && ! printf '%s' "$FILE_PATH" | grep -Eq '(^|/)\.env\.example$'; then
    block "$REASON"
  fi
  allow
fi

# --- Bash tool branch ---
[ -z "$CMD" ] && allow

# (a) Does the command reference a .env secret file at all? (allow .env.example)
printf '%s' "$CMD" | grep -Eq '\.env(\.[A-Za-z0-9_.-]+)?\b' || allow
printf '%s' "$CMD" | grep -Eq '\.env\.example\b' && {
  printf '%s' "$CMD" | grep -Eq '\.env(\.[A-Za-z0-9_.-]+)?\b' | grep -vq 'example' || allow
}

# (b) CONTENT-READING verbs — the ways a file's bytes reach stdout. Sourcing (. /
# source), writing (>), existence checks (ls/test) are NOT here.
READ_VERBS='(^|[[:space:];&|`(])(cat|bat|less|more|head|tail|nl|tac|rev|sed|awk|grep|egrep|fgrep|rg|ag|od|xxd|hexdump|hd|strings|base64|cut|tr|dd|xargs|read|mapfile|readarray)([[:space:]]|$)'
if printf '%s' "$CMD" | grep -Eq "$READ_VERBS"; then
  block "$REASON"
fi

# (c) Copying/moving the secret to a different name would launder it past this guard.
if printf '%s' "$CMD" | grep -Eq '(^|[[:space:];&|`(])(cp|mv|ln|install|tee|rsync|scp)([[:space:]])'; then
  block "$REASON"
fi

allow
