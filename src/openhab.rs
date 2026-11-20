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
const SERVER_COMMIT: &str = "87fb014f46ae086b24be20d8820df92429ad29fe";
const SERVER_SCRIPT_NAME: &str = "openhab-language-server.js";
/// Raw file URL pinned to `SERVER_COMMIT`; bump together with `version`
/// in `extension.toml` when the bundle changes.
const SERVER_DOWNLOAD_URL: &str = "https://raw.githubusercontent.com/gluek/zed-extension-openhab/87fb014f46ae086b24be20d8820df92429ad29fe/server/openhab-language-server.js";

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
        let request = HttpRequest::builder()
            .method(HttpMethod::Get)
            .url(SERVER_DOWNLOAD_URL)
            .redirect_policy(RedirectPolicy::FollowAll)
            .build()?;
        let response = request.fetch().map_err(|e| {
            format!("openHAB extension: failed to download the language server from {SERVER_DOWNLOAD_URL}: {e}")
        })?;
        if response.body.is_empty() {
            return Err(format!(
                "openHAB extension: download of the language server from {SERVER_DOWNLOAD_URL} returned an empty body"
            ));
        }
        std::fs::write(&script, &response.body).map_err(|e| {
            format!("openHAB extension: failed to write language server bundle to {script}: {e}")
        })?;
        std::fs::write(&marker, SERVER_COMMIT)
            .map_err(|e| format!("openHAB extension: failed to write {marker}: {e}"))?;
        Ok(script)
    }

    /// User overrides from Zed's `lsp.openhab-lsp.settings`.
    fn user_settings(worktree: &Worktree) -> serde_json::Value {
        zed::settings::LspSettings::for_worktree(SERVER_ID, worktree)
            .ok()
            .and_then(|settings| settings.settings)
            .unwrap_or_else(|| json!({}))
    }

    /// Fill in defaults for keys the server expects but the user omitted.
    ///
    /// Defaults mirror the VS Code extension's contributed configuration:
    /// `openhab.connection.host` defaults to `localhost` and `port` to 8080.
    /// `itemCasing` is deliberately absent: upstream only uses it for the
    /// "Create Items from Channels" command, which has no Zed equivalent, so
    /// shipping it here would be dead configuration.
    fn with_defaults(mut settings: serde_json::Value) -> serde_json::Value {
        let defaults = json!({
            "host": "localhost",
            "port": 8080,
            "authToken": null,
            "basicAuth": null,
            "lspEnabled": true,
        });

        if let (Some(target), Some(defaults)) = (settings.as_object_mut(), defaults.as_object()) {
            for (key, value) in defaults {
                target.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
        settings
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
        Ok(Some(Self::with_defaults(Self::user_settings(worktree))))
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
            "openhab": Self::with_defaults(Self::user_settings(worktree)),
        })))
    }
}

zed::register_extension!(OpenHabExtension);
