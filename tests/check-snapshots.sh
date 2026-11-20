#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Grammar the snapshots are checked against: the purpose-built
# tree-sitter-openhab grammar in grammar/.
GRAMMAR="openhab"

HARNESS=".scratch/target-openhab/debug/harness"
if [ ! -x "$HARNESS" ]; then
    echo "Building openHAB harness..."
    ( cd tests/harness && CARGO_HOME=../../.scratch/cargo \
        CARGO_TARGET_DIR=../../.scratch/target-openhab \
        OPENHAB_ZED_GRAMMAR=openhab \
        OPENHAB_GRAMMAR="$PWD/../../grammar/src" \
        cargo build --offline )
fi

TREES_DIR="tests/trees"
FIXTURES_DIR="tests/fixtures"

echo "checking snapshots with grammar: $GRAMMAR ($HARNESS)"

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
