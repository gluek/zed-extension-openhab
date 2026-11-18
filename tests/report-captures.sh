#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Grammar the reports are generated with. Defaults to the Phase B openHAB
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

REPORTS_DIR="tests/reports"
FIXTURES_DIR="tests/fixtures"

echo "generating capture reports with grammar: $GRAMMAR ($HARNESS)"
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
