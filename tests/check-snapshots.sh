#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

HARNESS="tests/harness/target/debug/harness"
TREES_DIR="tests/trees"
FIXTURES_DIR="tests/fixtures"

# Build the harness if the binary is missing. Crates are cached in the local
# registry (network access is restricted), so this works offline.
if [ ! -x "$HARNESS" ]; then
    echo "Building harness..."
    ( cd tests/harness && cargo build --offline )
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

ok=0
bad=0

for fixture in "$FIXTURES_DIR"/*; do
    [ -f "$fixture" ] || continue
    name=$(basename "$fixture")
    snapshot="$TREES_DIR/$name.txt"

    if [ ! -f "$snapshot" ]; then
        echo "MISSING $name"
        bad=$((bad + 1))
        continue
    fi

    "$HARNESS" --tree "$fixture" >"$tmp"
    if cmp -s "$tmp" "$snapshot"; then
        echo "OK $name"
        ok=$((ok + 1))
    else
        echo "CHANGED $name"
        bad=$((bad + 1))
    fi
done

echo ""
echo "$ok ok, $bad changed or missing"

if [ "$bad" -ne 0 ]; then
    echo "run ./tests/update-snapshots.sh only if the grammar rev or a fixture changed on purpose"
    exit 1
fi
