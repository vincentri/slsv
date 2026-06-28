use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

pub struct ServerChild(Mutex<Option<CommandChild>>);

fn config_path() -> PathBuf {
    dirs::home_dir()
        .expect("no home dir")
        .join(".slsv")
        .join("slui.yaml")
}

fn server_script(app: &AppHandle) -> PathBuf {
    // prod: bundled resource
    if let Ok(p) = app
        .path()
        .resolve("dist-server/cli.js", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return p;
        }
    }
    // dev: walk up from binary to find dist-server/cli.js
    let mut dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();
    for _ in 0..6 {
        let candidate = dir.join("dist-server").join("cli.js");
        if candidate.exists() {
            return candidate;
        }
        match dir.parent() {
            Some(p) => dir = p.to_path_buf(),
            None => break,
        }
    }
    PathBuf::from("dist-server/cli.js")
}

fn spawn_server(app: &AppHandle) -> Result<CommandChild, String> {
    let script = server_script(app);
    let config = config_path();
    let cmd = format!(
        "exec node '{}' --config '{}'",
        script.display(),
        config.display()
    );
    let (_, child) = app
        .shell()
        .command("sh")
        .args(["-l", "-c", &cmd])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(child)
}

#[tauri::command]
fn get_config() -> Result<String, String> {
    let path = config_path();
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("accounts: []\n".to_string())
    }
}

#[tauri::command]
fn save_config(app: AppHandle, yaml: String) -> Result<(), String> {
    let path = config_path();
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&path, yaml).map_err(|e| e.to_string())?;

    let state = app.state::<ServerChild>();
    let mut guard = state.0.lock().unwrap();
    if let Some(old) = guard.take() {
        old.kill().ok();
        std::thread::sleep(std::time::Duration::from_millis(600));
    }
    let child = spawn_server(&app)?;
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
async fn sso_login(app: AppHandle, profile: String) -> Result<(), String> {
    let cmd = format!("aws sso login --profile '{}'", profile);
    let output = app
        .shell()
        .command("sh")
        .args(["-l", "-c", &cmd])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        app.emit("sso-done", &profile).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServerChild(Mutex::new(None)))
        .setup(|app| {
            match spawn_server(app.handle()) {
                Ok(child) => {
                    *app.state::<ServerChild>().0.lock().unwrap() = Some(child);
                }
                Err(e) => eprintln!("Failed to start server: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, save_config, sso_login])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
