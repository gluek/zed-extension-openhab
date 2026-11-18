#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

HARNESS="tests/harness/target/debug/harness"

# Build the harness if the binary is missing. Crates are cached in the local
# registry (network access is restricted), so this works offline.
if [ ! -x "$HARNESS" ]; then
    echo "Building harness..."
    ( cd tests/harness && cargo build --offline )
fi

# Compiling a query is what catches typos, unknown node kinds, and malformed
# predicates; no fixture is needed for that.
failed=0
for query in languages/openhab/*.scm; do
    if "$HARNESS" --compile "$query" >/dev/null 2>&1; then
        echo "PASS $query"
    else
        echo "FAIL $query"
        "$HARNESS" --compile "$query" || true
        failed=$((failed + 1))
    fi
done

echo ""
if [ "$failed" -ne 0 ]; then
    echo "$failed query file(s) failed to compile"
    exit 1
fi
echo "all queries compile"
