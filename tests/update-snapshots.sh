#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Grammar the snapshots are generated with. Defaults to the Phase B openHAB
# grammar; set OPENHAB_ZED_GRAMMAR=java for the Phase A baseline.
GRAMMAR="${OPENHAB_ZED_GRAMMAR:-openhab}"

if [ "$GRAMMAR" = "openhab" ]; then
    HARNESS=".scratch/target-openhab/debug/harness"
    if [ ! -x "$HARNESS" ]; then
        echo "Building openHAB harness..."
        ( cd tests/harness && CARGO_HOME=../../.scratch/cargo \
            CARGO_TARGET_DIR=../../.scratch/target-openhab \
            OPENHAB_ZED_GRAMMAR=openhab \
            OPENHAB_GRAMMAR="$PWD/../../grammar/src" \
            cargo build --offline )
    fi
else
    HARNESS="tests/harness/target/debug/harness"
    # Build the harness if the binary is missing. Crates are cached in the local
    # registry (network access is restricted), so this works offline.
    if [ ! -x "$HARNESS" ]; then
        echo "Building harness..."
        ( cd tests/harness && cargo build --offline )
    fi
fi

TREES_DIR="tests/trees"
FIXTURES_DIR="tests/fixtures"

echo "generating snapshots with grammar: $GRAMMAR ($HARNESS)"
mkdir -p "$TREES_DIR"

find "$FIXTURES_DIR" -type f | sort | while IFS= read -r fixture; do
    name=$(basename "$fixture")
    "$HARNESS" --tree "$fixture" >"$TREES_DIR/$name.txt"
    echo "wrote $TREES_DIR/$name.txt"
done
