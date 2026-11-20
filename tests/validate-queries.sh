#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Grammar the queries are validated against: the purpose-built
# tree-sitter-openhab grammar in grammar/.
GRAMMAR="${OPENHAB_ZED_GRAMMAR:-openhab}"

HARNESS=".scratch/target-openhab/debug/harness"
if [ ! -x "$HARNESS" ]; then
    echo "Building openHAB harness..."
    ( cd tests/harness && CARGO_HOME=../../.scratch/cargo \
        CARGO_TARGET_DIR=../../.scratch/target-openhab \
        OPENHAB_ZED_GRAMMAR=openhab \
        OPENHAB_GRAMMAR="$PWD/../../grammar/src" \
        cargo build --offline )
fi

echo "validating queries against grammar: $GRAMMAR ($HARNESS)"

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
