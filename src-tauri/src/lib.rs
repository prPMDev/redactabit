// Write text to an arbitrary file path (creating parent folders). A small app command instead
// of the fs plugin so a user-chosen "Save redacted files to" folder needs no scope wrangling.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
  let p = std::path::Path::new(&path);
  if let Some(dir) = p.parent() {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  std::fs::write(p, contents).map_err(|e| e.to_string())
}

// Make sure a folder exists before we reveal it (the OS file explorer can't open a missing dir).
#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
  std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

// Write binary contents (e.g. a redacted PDF) to a path, creating parent folders. Binary twin of
// write_text_file for the PDF-output path.
#[tauri::command]
fn write_bytes_file(path: String, contents: Vec<u8>) -> Result<(), String> {
  let p = std::path::Path::new(&path);
  if let Some(dir) = p.parent() {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  std::fs::write(p, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![write_text_file, ensure_dir, write_bytes_file])
    .setup(|app| {
      // Logging runs in every build (not only debug) so the log directory exists and the
      // "Open log directory" button in About actually reveals something on the installed app.
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      log::info!("Redactabit {} started", env!("CARGO_PKG_VERSION"));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
