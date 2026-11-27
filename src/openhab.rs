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
const SERVER_COMMIT: &str = "0f8b3ed94235134d8632e1bcbdcd8ad59b78cfaa";
const SERVER_SCRIPT_NAME: &str = "openhab-language-server.js";

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
