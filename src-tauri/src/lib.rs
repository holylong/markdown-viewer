use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::path::Path;

const MAX_TREE_DEPTH: usize = 24;
const MAX_DOCUMENTS: usize = 10_000;

#[derive(Serialize)]
struct FileTreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FileTreeNode>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            save_text_file,
            save_binary_file,
            list_markdown_files,
            rename_file,
            reveal_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    match std::str::from_utf8(&bytes) {
        Ok(s) => Ok(s.to_owned()),
        Err(_) => {
            let (decoded, _, _) = encoding_rs::GBK.decode(&bytes);
            Ok(decoded.into_owned())
        }
    }
}

#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    let mut bytes = Vec::with_capacity(contents.len() + 3);
    bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    bytes.extend_from_slice(contents.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_binary_file(path: String, contents_base64: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(contents_base64)
        .map_err(|error| format!("无法解析导出文件数据: {error}"))?;
    std::fs::write(&path, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old = Path::new(&old_path);
    let new = Path::new(&new_path);
    if !old.is_file() {
        return Err("原文件不存在或已被移动".to_string());
    }
    if new.exists() {
        return Err("目标文件名已存在".to_string());
    }
    let parent = new.parent().ok_or("目标路径无效")?;
    if !parent.is_dir() {
        return Err("目标文件夹不存在".to_string());
    }
    std::fs::rename(old, new).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let file = std::fs::canonicalize(&path)
        .map_err(|error| format!("文件不存在或无法访问: {error}"))?;
    if !file.is_file() {
        return Err("所选路径不是文件".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Explorer does not accept the Windows extended-length path prefix.
        let display_path = file.to_string_lossy();
        let display_path = if let Some(unc) = display_path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else {
            display_path.strip_prefix(r"\\?\").unwrap_or(&display_path).to_string()
        };
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{display_path}\""))
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| format!("无法打开所在文件夹: {error}"))?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R").arg(&file).spawn()
        .map_err(|error| format!("无法打开所在文件夹: {error}"))?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(file.parent().ok_or("文件所在目录不存在")?).spawn()
        .map_err(|error| format!("无法打开所在文件夹: {error}"))?;
    Ok(())
}

#[tauri::command]
fn list_markdown_files(path: String) -> Result<Vec<FileTreeNode>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err("所选路径不是文件夹或已不存在".to_string());
    }

    let mut document_count = 0;
    collect_markdown_entries(root, 0, &mut document_count)
}

fn collect_markdown_entries(
    directory: &Path,
    depth: usize,
    document_count: &mut usize,
) -> Result<Vec<FileTreeNode>, String> {
    if depth > MAX_TREE_DEPTH || *document_count >= MAX_DOCUMENTS {
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(directory)
        .map_err(|error| format!("无法读取文件夹 {}: {error}", directory.to_string_lossy()))?;
    let mut nodes = Vec::new();

    for entry in entries.flatten() {
        if *document_count >= MAX_DOCUMENTS {
            break;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if should_skip_directory(&name) {
                continue;
            }
            let children =
                collect_markdown_entries(&path, depth + 1, document_count).unwrap_or_default();
            if !children.is_empty() {
                nodes.push(FileTreeNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_dir: true,
                    children,
                });
            }
        } else if file_type.is_file() && is_supported_document(&path) {
            *document_count += 1;
            nodes.push(FileTreeNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    nodes.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(nodes)
}

fn is_supported_document(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd" | "txt"
            )
        })
        .unwrap_or(false)
}

fn should_skip_directory(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules" | "target" | "dist" | "build" | "vendor"
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn detects_supported_document_extensions_case_insensitively() {
        assert!(is_supported_document(&PathBuf::from("notes.MD")));
        assert!(is_supported_document(&PathBuf::from("draft.markdown")));
        assert!(is_supported_document(&PathBuf::from("readme.txt")));
        assert!(!is_supported_document(&PathBuf::from("photo.png")));
    }

    #[test]
    fn skips_generated_and_hidden_directories() {
        assert!(should_skip_directory(".git"));
        assert!(should_skip_directory("node_modules"));
        assert!(should_skip_directory("TARGET"));
        assert!(!should_skip_directory("articles"));
    }

    #[test]
    fn writes_decoded_binary_files() {
        let path = std::env::temp_dir().join(format!(
            "markdown-viewer-pdf-test-{}.pdf",
            std::process::id()
        ));
        save_binary_file(
            path.to_string_lossy().into_owned(),
            "JVBERi0xLjQKJSVFT0YK".to_string(),
        )
        .expect("binary PDF data should be written");

        let contents = std::fs::read(&path).expect("written PDF should be readable");
        assert!(contents.starts_with(b"%PDF-1.4"));
        std::fs::remove_file(path).expect("temporary PDF should be removable");
    }
}
