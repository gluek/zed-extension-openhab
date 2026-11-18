use zed_extension_api::{
    self as zed, serde_json::json, Command, Extension, LanguageServerId, Result, Worktree,
};

const SERVER_ID: &str = "openhab-lsp";

/// Bundled language server entry point, relative to the extension root.
///
/// `server/openhab-language-server.js` is a single esbuild bundle committed to
/// the repository, so the extension needs no `npm install` at runtime and no
/// `node_modules` alongside it.
const SERVER_SCRIPT: &str = "server/openhab-language-server.js";

struct OpenHabExtension;

impl OpenHabExtension {
    fn server_script() -> Result<String> {
        if std::fs::metadata(SERVER_SCRIPT).is_ok() {
            return Ok(SERVER_SCRIPT.to_string());
        }
        Err(format!(
            "openHAB language server bundle ({SERVER_SCRIPT}) is missing. \
             Run `npm install && npm run build` in the server/ directory and reload the extension."
        ))
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
        // The server asks for the `openhab` section specifically, so the
        // resolved settings are nested under that key.
        Ok(Some(json!({
            "openhab": Self::with_defaults(Self::user_settings(worktree)),
        })))
    }
}

zed::register_extension!(OpenHabExtension);
