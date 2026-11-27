use zed_extension_api::{
    self as zed,
    http_client::{HttpMethod, HttpRequest, RedirectPolicy},
    serde_json::json,
    Command, Extension, LanguageServerId, LanguageServerInstallationStatus, Result, Worktree,
};

const SERVER_ID: &str = "openhab-lsp";

/// Release artifact of this repository that ships the pre-built server
/// bundle. Pinned to a commit so the download is reproducible; bump it
/// together with `version` in `extension.toml` when the bundle changes.
/// The bundle itself is *not* embedded in the extension wasm (Zed's
/// publishing rules forbid bundling a language server); it is fetched
/// at runtime through the extension API.
const SERVER_COMMIT: &str = "8a1c81f53ff5c2358b3a8dd7f00102f3765fc4e7";
const SERVER_SCRIPT_NAME: &str = "openhab-language-server.js";

/// SHA-256 of the server bundle at `SERVER_COMMIT` (lower-case hex). The
/// downloaded body is verified against it before anything is written, so a
/// corrupted, truncated, or mismatched download never replaces a working
/// script. Bump together with `SERVER_COMMIT` (and `version` in
/// `extension.toml`) whenever the bundle changes.
const SERVER_SHA256: &str = "b227b3bc58dfe164a3fd7f3db5921b1a9fb206b5f93da0a6322988913730d8bf";

/// SHA-256 of `data` as lower-case hex.
///
/// Self-contained on purpose: the extension has no hash crate (the offline
/// cargo home carries none either, and one more dependency would only grow
/// the wasm). The implementation is the FIPS 180-4 algorithm; the unit test
/// below checks it against the standard test vectors.
fn sha256(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    // Initial state: first 32 bits of the fractional parts of the square
    // roots of the first eight primes.
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    // Pad to data || 0x80 || zeros || 8-byte big-endian bit length, so the
    // total is a multiple of 64 bytes.
    let mut message = Vec::with_capacity(data.len() + 72);
    message.extend_from_slice(data);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&(((data.len() as u64) * 8).to_be_bytes()));

    for block in message.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([block[i * 4], block[i * 4 + 1], block[i * 4 + 2], block[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d) = (h[0], h[1], h[2], h[3]);
        let (mut e, mut f, mut g, mut hh) = (h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choose = (e & f) ^ (!e & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(choose).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(majority);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    h.iter().map(|word| format!("{word:08x}")).collect()
}

/// Raw-file URL of the server bundle at `SERVER_COMMIT`, derived from the
/// commit so the pin lives in exactly one place. Bump `SERVER_COMMIT`
/// together with `version` in `extension.toml` when the bundle changes.
fn server_download_url() -> String {
    format!("https://raw.githubusercontent.com/gluek/zed-extension-openhab/{SERVER_COMMIT}/server/{SERVER_SCRIPT_NAME}")
}

struct OpenHabExtension;

impl OpenHabExtension {
    /// Ensures the language server bundle is present in the extension's work
    /// directory, downloading it through the Zed extension API if missing or
    /// stale, and returns its absolute host path.
    ///
    /// Zed runs extension wasm with only the extension work directory
    /// (`$XDG_DATA_HOME/zed/extensions/work/<id>`, exposed as both `.` and
    /// its absolute path, with `PWD` pointing at it) preopened and writable,
    /// so the server script is stored there. The returned path is absolute
    /// because Zed spawns the language server process with the worktree root
    /// as CWD, not the extension directory.
    fn server_script(language_server_id: &LanguageServerId) -> Result<String> {
        let work_dir = std::env::var("PWD").map_err(|_| {
            "openHAB extension: PWD is not set; cannot locate the extension work directory"
                .to_string()
        })?;
        let script = format!("{work_dir}/{SERVER_SCRIPT_NAME}");
        let marker = format!("{script}.sha");

        let up_to_date = std::fs::read_to_string(&marker)
            .map(|recorded| recorded.trim() == SERVER_COMMIT)
            .unwrap_or(false);
        if up_to_date && std::fs::metadata(&script).is_ok() {
            return Ok(script);
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &LanguageServerInstallationStatus::Downloading,
        );
        let url = server_download_url();
        let request = HttpRequest::builder()
            .method(HttpMethod::Get)
            .url(url.clone())
            .redirect_policy(RedirectPolicy::FollowAll)
            .build()?;
        let response = request.fetch().map_err(|e| {
            format!("openHAB extension: failed to download the language server from {url}: {e}")
        })?;
        if response.body.is_empty() {
            return Err(format!(
                "openHAB extension: download of the language server from {url} returned an empty body"
            ));
        }
        let digest = sha256(&response.body);
        if digest != SERVER_SHA256 {
            return Err(format!(
                "openHAB extension: language server bundle from {url} failed its integrity check \
                 (sha256 {digest}, expected {SERVER_SHA256})"
            ));
        }
        std::fs::write(&script, &response.body).map_err(|e| {
            format!("openHAB extension: failed to write language server bundle to {script}: {e}")
        })?;
        std::fs::write(&marker, SERVER_COMMIT)
            .map_err(|e| format!("openHAB extension: failed to write {marker}: {e}"))?;
        Ok(script)
    }

    /// User overrides from Zed's `lsp.openhab-lsp.settings`, passed through
    /// unchanged. The server owns the defaults (DEFAULT_SETTINGS in
    /// server/src/Server.js), so there is a single source of truth.
    fn user_settings(worktree: &Worktree) -> serde_json::Value {
        zed::settings::LspSettings::for_worktree(SERVER_ID, worktree)
            .ok()
            .and_then(|settings| settings.settings)
            .unwrap_or_else(|| json!({}))
    }
}

impl Extension for OpenHabExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> Result<Command> {
        if language_server_id.as_ref() != SERVER_ID {
            return Err(format!("Unknown language server: {language_server_id}"));
        }

        Ok(Command {
            // Zed bundles Node.js; no separate runtime download required.
            command: zed::node_binary_path()?,
            // `--stdio` is explicit: the server defaults to stdio, but passing it
            // keeps parity with what vscode-languageserver expects under Zed.
            args: vec![
                Self::server_script(language_server_id)?,
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Option<serde_json::Value>> {
        if language_server_id.as_ref() != SERVER_ID {
            return Ok(None);
        }
        Ok(Some(Self::user_settings(worktree)))
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Option<serde_json::Value>> {
        if language_server_id.as_ref() != SERVER_ID {
            return Ok(None);
        }
        // The server asks for the `openhab` section specifically, so the
        // resolved settings are nested under that key.
        Ok(Some(json!({
            "openhab": Self::user_settings(worktree),
        })))
    }
}

zed::register_extension!(OpenHabExtension);

#[cfg(test)]
mod tests {
    use super::sha256;

    #[test]
    fn sha256_matches_fips_180_4_vectors() {
        // Empty message (single padded block).
        assert_eq!(
            sha256(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // "abc" (single block).
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // 43-byte message (single block, different padding length).
        assert_eq!(
            sha256(b"The quick brown fox jumps over the lazy dog"),
            "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
        );
        // 56-byte message: the length suffix no longer fits, forcing a second
        // padding block.
        assert_eq!(
            sha256(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        // One million 'a's: many compression rounds, and a 3-byte-overflow
        // bit length in the final block.
        assert_eq!(
            sha256(&[b'a'; 1_000_000]),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }
}
