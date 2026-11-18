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

mkdir -p "$TREES_DIR"

find "$FIXTURES_DIR" -type f | sort | while IFS= read -r fixture; do
    name=$(basename "$fixture")
    "$HARNESS" --tree "$fixture" >"$TREES_DIR/$name.txt"
    echo "wrote $TREES_DIR/$name.txt"
done
