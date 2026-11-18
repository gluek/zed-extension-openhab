#!/bin/sh
# Rebuild the local git mirror of grammar/ that extension.toml's
# [grammars.openhab] repository points at (file:// URL + rev).
#
# Zed clones the grammar repository and checks out `rev`, so the mirror must
# be a real git repo whose root contains grammar.js and src/. This script
# refreshes .scratch/grammar-repo from grammar/ and prints the new rev to pin
# in extension.toml.
#
# Usage:
#   ./tests/make-grammar-mirror.sh            # rebuild + print rev
#   ./tests/make-grammar-mirror.sh <rev>      # verify the mirror matches <rev>
set -eu

cd "$(dirname "$0")/.."

MIRROR=".scratch/grammar-repo"

if [ "${1:-}" != "" ]; then
    # Verify mode: the mirror HEAD must equal the given rev.
    head=$(git -C "$MIRROR" rev-parse HEAD)
    if [ "$head" = "$1" ]; then
        echo "ok: $MIRROR HEAD matches $1"
        exit 0
    fi
    echo "stale: $MIRROR HEAD is $head, extension.toml pins $1" >&2
    exit 1
fi

mkdir -p "$MIRROR"
if [ ! -d "$MIRROR/.git" ]; then
    git init -q -b master "$MIRROR"
fi

# Sync grammar/ contents into the mirror (delete removed files too).
find "$MIRROR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r grammar/. "$MIRROR"/

git -C "$MIRROR" add -A
if git -C "$MIRROR" diff --cached --quiet; then
    echo "unchanged: $(git -C "$MIRROR" rev-parse HEAD)"
else
    GIT_EDITOR=true git -C "$MIRROR" \
        -c user.name="openhab-zed dev" -c user.email="dev@localhost" \
        commit -qm "tree-sitter-openhab grammar (mirror of openhab-zed/grammar)"
    echo "new rev: $(git -C "$MIRROR" rev-parse HEAD)  <- pin this in extension.toml [grammars.openhab] rev"
fi
