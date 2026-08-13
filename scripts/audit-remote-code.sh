#!/usr/bin/env bash
#
# audit-remote-code.sh
#
# Scans for the three things that must not ship in Lectern:
#   1. Upstream identity (extension ID, author domains, inherited OAuth client)
#   2. Upstream-hosted services (S3 bucket, synthesis endpoints)
#   3. Remotely hosted code (any http/https script reference)
#
# Run against the source tree during development, and against the UNPACKED
# PRODUCTION BUILD before every store upload. Build steps can reintroduce things.
#
# Usage:
#   ./scripts/audit-remote-code.sh [path]     # defaults to repo root
#
# Exit 0 = clean. Exit 1 = findings. Exit 2 = usage error.

set -uo pipefail

TARGET="${1:-.}"
FAIL=0

if [ ! -d "$TARGET" ]; then
  echo "error: not a directory: $TARGET" >&2
  exit 2
fi

# Paths excluded from scanning. Attribution files are allowed to name upstream.
EXCLUDES=(
  --exclude-dir=.git
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=docs
  --exclude-dir=coverage
  --exclude=NOTICE
  --exclude=FORK.md
  --exclude=LICENSE
  --exclude=CLAUDE.md
  --exclude=audit-remote-code.sh
  --exclude=verify-manifest.sh
  --exclude=package-lock.json
  --exclude='*.map'
)

# URLs permitted to appear in shipped code. Attribution links live here.
# Add entries only with a written justification.
ALLOWLIST_REGEX='https://github\.com/ken107/read-aloud|https://opensource\.org/licenses/MIT|http://www\.w3\.org/'

hr() { printf '%s\n' "----------------------------------------------------------------"; }

report() {
  # $1 = section label, $2 = grep output
  local label="$1" out="$2"
  if [ -n "$out" ]; then
    hr
    echo "FAIL: $label"
    hr
    printf '%s\n' "$out"
    echo
    FAIL=1
  else
    echo "  ok: $label"
  fi
}

echo "Lectern remote code audit"
echo "target: $(cd "$TARGET" && pwd)"
echo

# ---------------------------------------------------------------- 1. identity

out=$(grep -rInE "hdhinadidafjejdhmfkjgnolgimiaplp" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null)
report "upstream Chrome Web Store extension ID" "$out"

out=$(grep -rInE "lsdsoftware|readaloud\.app|hai\.phan" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null)
report "upstream author domains and contact" "$out"

out=$(grep -rInE "311515340069|apps\.googleusercontent\.com" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null)
report "inherited Google OAuth client_id" "$out"

# ---------------------------------------------------------------- 2. services

out=$(grep -rInE "lsdsoftware-assets|s3://|s3\.amazonaws\.com|page-scripts" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null)
report "upstream S3 bucket and page-script loader" "$out"

out=$(grep -rInE "sync-page-scripts|aws s3 sync" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null)
report "S3 sync tooling" "$out"

# ------------------------------------------------------- 3. remote hosted code

# Chrome's own guidance for the MV3 remote-code rejection is to search for
# http:// and https:// across the project. Allowlisted URLs are filtered out.
out=$(grep -rInE "https?://" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null \
      | grep -vE "$ALLOWLIST_REGEX")
report "http/https references (MV3 remote hosted code check)" "$out"

# Dynamic code execution patterns that reviewers flag.
out=$(grep -rInE "\beval\(|new Function\(|importScripts\(|document\.write\(" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null)
report "dynamic code execution patterns" "$out"

# Script tags built at runtime, the classic remote-load pattern.
out=$(grep -rInE "createElement\(['\"]script['\"]\)" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null)
report "runtime script element creation" "$out"

# --------------------------------------------------------------- 4. leftovers

# The allowlisted attribution URL legitimately contains the upstream name, so it
# is filtered here. A bare mention of the upstream name anywhere else is a leak.
out=$(grep -rInE "read[ _-]?aloud" "${EXCLUDES[@]}" "$TARGET" 2>/dev/null \
      | grep -vE "$ALLOWLIST_REGEX")
report "upstream product name in shipped files (branding leak)" "$out"

# Locale files are the classic leak. Scanned separately so the finding is obvious.
if [ -d "$TARGET/_locales" ]; then
  out=$(grep -rInE "read[ _-]?aloud" "$TARGET/_locales" 2>/dev/null)
  report "upstream product name in _locales (check every language)" "$out"
fi

echo
hr
if [ "$FAIL" -eq 0 ]; then
  echo "AUDIT CLEAN"
  hr
  exit 0
else
  echo "AUDIT FAILED. Resolve every finding above before uploading."
  echo "Anything genuinely intentional goes in the allowlist with a written"
  echo "justification, not silently ignored."
  hr
  exit 1
fi
