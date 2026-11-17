use zed_extension_api::{
    self as zed, serde_json::json, Command, Extension, LanguageServerId, Result, Worktree,
};

const SERVER_ID: &str = "openhab-lsp";

/// Location of the bundled language server entry point, relative to the
/// extension root. During development the extension is loaded from
/// `zed/openhab-zed`, so we also look in the sibling `serverJS/out` folder.
const SERVER_CANDIDATES: [&str; 2] = ["server/LSPServer.js", "../serverJS/out/LSPServer.js"];

struct OpenHabExtension;

impl OpenHabExtension {
    fn server_script() -> Result<String> {
        SERVER_CANDIDATES
            .iter()
            .find(|path| std::fs::metadata(path).is_ok())
            .map(|path| path.to_string())
            .ok_or_else(|| {
                "openHAB language server bundle (server/LSPServer.js) was not found. \
                 Run `npm run package` in the extension root first."
                    .to_string()
            })
    }

    /// User overrides from Zed's `lsp.openhab-lsp.settings`.
    fn user_settings(worktree: &Worktree) -> serde_json::Value {
        zed::settings::LspSettings::for_worktree(SERVER_ID, worktree)
            .ok()
            .and_then(|settings| settings.settings)
            .unwrap_or_else(|| json!({}))
    }

    /// Fill in defaults for keys the server expects but the user omitted.
    fn with_defaults(mut settings: serde_json::Value) -> serde_json::Value {
        let defaults = json!({
            "host": "localhost",
            "port": 8080,
            "authToken": null,
            "itemCasing": "original",
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
            args: vec![Self::server_script()?, "--stdio".to_string()],
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
        // The server also calls `workspace/configuration` for the `openhab`
        // section; answer it with the same resolved settings.
        Ok(Some(json!({
            "openhab": Self::with_defaults(Self::user_settings(worktree)),
        })))
    }
}

zed::register_extension!(OpenHabExtension);
