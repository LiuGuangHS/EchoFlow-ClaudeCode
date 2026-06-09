// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

const ECHOFLOW_APP_NAME: &str = "EchoFlow Code";
const ECHOFLOW_DEFAULT_CONFIG_ENV: &str = "ECHOFLOW_CODE_DEFAULT_CONFIG_DIR";
const ECHOFLOW_PORTABLE_ENV: &str = "ECHOFLOW_CODE_APP_PORTABLE_DIR";

enum StartupConfigDir {
    Portable(PathBuf),
    Default(PathBuf),
}

fn main() {
    // Resolve CLAUDE_CONFIG_DIR before any Tauri/WebView2 initialization so
    // the legacy host uses the same EchoFlow data root as Electron.
    //
    // Mode resolution order:
    //   1. External CLAUDE_CONFIG_DIR env var (batch script etc.) — always respected
    //   2. Persisted app-mode.json saying "portable"
    //   3. EchoFlow default app data directory
    //
    if let Some(config_dir) = determine_startup_config_dir() {
        match config_dir {
            StartupConfigDir::Portable(portable_dir) => {
                std::env::set_var(
                    "CLAUDE_CONFIG_DIR",
                    portable_dir.to_string_lossy().to_string(),
                );
                std::env::set_var(ECHOFLOW_PORTABLE_ENV, "1");
            }
            StartupConfigDir::Default(default_dir) => {
                std::env::set_var(
                    "CLAUDE_CONFIG_DIR",
                    default_dir.to_string_lossy().to_string(),
                );
                std::env::set_var(ECHOFLOW_DEFAULT_CONFIG_ENV, "1");
            }
        }
    }

    // If CLAUDE_CONFIG_DIR is set (either from env or from our startup logic above),
    // redirect WebView2 user data folder so EBWebView cache lives alongside it.
    if let Ok(config_dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        let webview_data = PathBuf::from(&config_dir).join("EBWebView");
        if let Err(e) = fs::create_dir_all(&webview_data) {
            eprintln!("[desktop] failed to create EBWebView dir: {e}");
        }
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data);
    }

    claude_code_desktop_lib::run()
}

fn determine_startup_config_dir() -> Option<StartupConfigDir> {
    if std::env::var("CLAUDE_CONFIG_DIR").is_ok() {
        return None;
    }

    determine_startup_portable_dir()
        .map(StartupConfigDir::Portable)
        .or_else(|| default_echoflow_data_root().map(StartupConfigDir::Default))
}

fn default_echoflow_data_root() -> Option<PathBuf> {
    default_echoflow_data_root_with(|key| std::env::var(key).ok())
}

fn default_echoflow_data_root_with<F>(env_var: F) -> Option<PathBuf>
where
    F: Fn(&str) -> Option<String>,
{
    #[cfg(target_os = "windows")]
    {
        let base = env_var("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                env_var("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData").join("Local"))
            })?;
        return Some(base.join(ECHOFLOW_APP_NAME));
    }

    #[cfg(target_os = "macos")]
    {
        let home = PathBuf::from(env_var("HOME")?);
        return Some(
            home.join("Library")
                .join("Application Support")
                .join(ECHOFLOW_APP_NAME),
        );
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(data_home) = env_var("XDG_DATA_HOME") {
            return Some(PathBuf::from(data_home).join("echoflow-code"));
        }
        let home = PathBuf::from(env_var("HOME")?);
        return Some(home.join(".local").join("share").join("echoflow-code"));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// Determine if we should start in portable mode.
/// Returns the portable config directory path if yes, None for default mode.
fn determine_startup_portable_dir() -> Option<PathBuf> {
    // 1. 如果外部已经设置了 CLAUDE_CONFIG_DIR 环境变量，我们不应该覆盖它，直接返回 None 让 main 保持原样
    if std::env::var("CLAUDE_CONFIG_DIR").is_ok() {
        return None;
    }

    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let mut default_portable = exe_dir.to_path_buf();
    default_portable.push("CLAUDE_CONFIG_DIR");

    // 辅助函数：读取 app-mode.json 获取模式和自定义便携路径
    fn get_mode_from_config(dir: &std::path::Path) -> Option<(String, Option<PathBuf>)> {
        let path = dir.join("app-mode.json");
        let data = std::fs::read_to_string(&path).ok()?;
        let parsed: serde_json::Value = serde_json::from_str(&data).ok()?;
        let mode = parsed
            .get("mode")
            .and_then(|m| m.as_str())
            .unwrap_or("default")
            .to_ascii_lowercase();
        let portable_dir = parsed
            .get("portable_dir")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);
        Some((mode, portable_dir))
    }

    // 2. 优先检查便携目录本地的配置文件（保证移动便携版到新电脑依然生效，并能正确处理切回默认模式）
    if let Some((mode, portable_dir)) = get_mode_from_config(&default_portable) {
        if mode == "portable" {
            if dir_has_portable_data(&default_portable) {
                return Some(default_portable.clone());
            }
            return Some(portable_dir.unwrap_or(default_portable.clone()));
        } else {
            return None; // 明确设置了 default，直接使用系统默认
        }
    }

    // 3. 检查系统全局配置
    #[cfg(target_os = "windows")]
    let system_config: Option<PathBuf> = std::env::var("APPDATA").ok().map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let system_config: Option<PathBuf> = std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join("Library").join("Application Support"));
    #[cfg(target_os = "linux")]
    let system_config: Option<PathBuf> = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| PathBuf::from(h).join(".config"))
        });

    if let Some(ref sys_cfg) = system_config {
        // Use the EchoFlow bundle identifier.
        let app_subdir = sys_cfg.join("com.echoflowai-claude-code.desktop");
        if let Some((mode, portable_dir)) = get_mode_from_config(&app_subdir) {
            if mode == "portable" {
                return Some(portable_dir.unwrap_or(default_portable.clone()));
            } else {
                return None; // 明确设置了 default
            }
        }
    }

    fn dir_has_portable_data(dir: &std::path::Path) -> bool {
        if !dir.is_dir() {
            return false;
        }
        [
            "settings.json",
            ".claude.json",
            ".mcp.json",
            "window-state.json",
            "terminal-config.json",
        ]
            .iter()
            .any(|f| dir.join(f).is_file())
            || dir.join("Cache").is_dir()
            || dir.join("EBWebView").is_dir()
            || dir.join("projects").is_dir()
            || dir.join("skills").is_dir()
            || dir.join("plugins").is_dir()
            || dir.join("cowork_plugins").is_dir()
    }

    None
}

#[cfg(test)]
mod tests {
    use super::default_echoflow_data_root_with;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn env_lookup(vars: HashMap<&'static str, &'static str>) -> impl Fn(&str) -> Option<String> {
        move |key| vars.get(key).map(|value| value.to_string())
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn default_echoflow_root_uses_local_app_data_on_windows() {
        let root = default_echoflow_data_root_with(env_lookup(HashMap::from([(
            "LOCALAPPDATA",
            r"C:\Users\tester\AppData\Local",
        )])))
        .expect("windows root should resolve");

        assert_eq!(
            root,
            PathBuf::from(r"C:\Users\tester\AppData\Local").join("EchoFlow Code")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn default_echoflow_root_falls_back_to_user_profile_on_windows() {
        let root = default_echoflow_data_root_with(env_lookup(HashMap::from([(
            "USERPROFILE",
            r"C:\Users\tester",
        )])))
        .expect("windows root should resolve");

        assert_eq!(
            root,
            PathBuf::from(r"C:\Users\tester")
                .join("AppData")
                .join("Local")
                .join("EchoFlow Code")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn default_echoflow_root_uses_application_support_on_macos() {
        let root =
            default_echoflow_data_root_with(env_lookup(HashMap::from([("HOME", "/Users/tester")])))
                .expect("macos root should resolve");

        assert_eq!(
            root,
            PathBuf::from("/Users/tester")
                .join("Library")
                .join("Application Support")
                .join("EchoFlow Code")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn default_echoflow_root_uses_xdg_data_home_on_linux() {
        let root = default_echoflow_data_root_with(env_lookup(HashMap::from([(
            "XDG_DATA_HOME",
            "/tmp/data",
        )])))
        .expect("linux root should resolve");

        assert_eq!(root, PathBuf::from("/tmp/data").join("echoflow-code"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn default_echoflow_root_falls_back_to_local_share_on_linux() {
        let root =
            default_echoflow_data_root_with(env_lookup(HashMap::from([("HOME", "/home/tester")])))
                .expect("linux root should resolve");

        assert_eq!(
            root,
            PathBuf::from("/home/tester")
                .join(".local")
                .join("share")
                .join("echoflow-code")
        );
    }
}
