#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Grammar the snapshots are generated with: the purpose-built
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

echo "generating snapshots with grammar: $GRAMMAR ($HARNESS)"
mkdir -p "$TREES_DIR"

find "$FIXTURES_DIR" -type f | sort | while IFS= read -r fixture; do
    name=$(basename "$fixture")
    "$HARNESS" --tree "$fixture" >"$TREES_DIR/$name.txt"
    echo "wrote $TREES_DIR/$name.txt"
done
