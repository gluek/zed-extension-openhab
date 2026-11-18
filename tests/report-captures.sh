#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

HARNESS="tests/harness/target/debug/harness"
REPORTS_DIR="tests/reports"
FIXTURES_DIR="tests/fixtures"

# Build the harness if the binary is missing. Crates are cached in the local
# registry (network access is restricted), so this works offline.
if [ ! -x "$HARNESS" ]; then
    echo "Building harness..."
    ( cd tests/harness && cargo build --offline )
fi

rm -rf "$REPORTS_DIR"
mkdir -p "$REPORTS_DIR"

# Query output is regenerated wholesale: a stale report is worse than none.
find tests/fixtures -type f | sort >/dev/null
find languages/openhab -name '*.scm' | sort | while IFS= read -r query; do
    query_name=$(basename "$query")
    find "$FIXTURES_DIR" -type f | sort | while IFS= read -r fixture; do
        fixture_name=$(basename "$fixture")
        "$HARNESS" --captures "$query" "$fixture" \
            >"$REPORTS_DIR/$query_name-$fixture_name.txt"
    done
done

echo "wrote $(ls "$REPORTS_DIR" | wc -l) reports to $REPORTS_DIR"
