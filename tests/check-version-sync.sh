#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Version/bundle sync check (CI runs this; run it before any release too):
#   1. extension.toml and Cargo.toml carry the same version
#      (extension.toml is the authoritative published version).
#   2. SERVER_COMMIT in src/openhab.rs is a commit in the local history.
#   3. The committed server bundle is byte-identical to the bundle at
#      SERVER_COMMIT — that blob is what the extension downloads at runtime.
#   4. SERVER_SHA256 in src/openhab.rs is the digest of that bundle.

BUNDLE=server/openhab-language-server.js

fail() {
    echo "check-version-sync: $1" >&2
    exit 1
}

# 1. Versions match.
ext_version=$(sed -n 's/^version = "\(.*\)"$/\1/p' extension.toml | head -n 1)
cargo_version=$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -n 1)
[ -n "$ext_version" ] || fail "could not read the version from extension.toml"
[ "$ext_version" = "$cargo_version" ] ||
    fail "extension.toml ($ext_version) and Cargo.toml ($cargo_version) versions differ; keep them in sync"

# 2. The pinned commit is present locally.
commit=$(sed -n 's/^const SERVER_COMMIT: &str = "\(.*\)";$/\1/p' src/openhab.rs | head -n 1)
[ -n "$commit" ] || fail "could not read SERVER_COMMIT from src/openhab.rs"
git cat-file -e "${commit}^{commit}" 2>/dev/null ||
    fail "SERVER_COMMIT $commit is not in the local history; push the bundle commit and re-pin"

# 3. The committed bundle is the one the extension downloads.
if ! git show "${commit}:${BUNDLE}" | cmp -s - "$BUNDLE"; then
    fail "committed $BUNDLE differs from the bundle at SERVER_COMMIT $commit
bump SERVER_COMMIT, SERVER_SHA256 and version per the deploy procedure"
fi

# 4. The pinned digest matches.
pinned=$(sed -n 's/^const SERVER_SHA256: &str = "\(.*\)";$/\1/p' src/openhab.rs | head -n 1)
[ -n "$pinned" ] || fail "could not read SERVER_SHA256 from src/openhab.rs"
actual=$(sha256sum "$BUNDLE" | cut -d ' ' -f 1)
[ "$pinned" = "$actual" ] ||
    fail "SERVER_SHA256 ($pinned) is not the digest of the committed bundle ($actual)"

echo "check-version-sync: OK (version $ext_version, bundle pinned at $commit, sha256 $actual)"
