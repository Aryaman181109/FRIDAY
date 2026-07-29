use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Window};

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_TRANSCRIPTIONS_URL: &str = "https://api.openai.com/v1/audio/transcriptions";
const OPENROUTER_CHAT_COMPLETIONS_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_CHAT_COMPLETIONS_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const AI_STREAM_EVENT: &str = "friday-ai-stream";
const FRIDAY_CONFIG_DIR_NAME: &str = "FRIDAY";
const AI_CONFIG_FILE_NAME: &str = "ai-provider.json";
const STT_CONFIG_FILE_NAME: &str = "stt-provider.json";
const VOICE_CONFIG_FILE_NAME: &str = "voice.json";
const LOCAL_WHISPER_DIR_NAME: &str = "whisper.cpp";
const LOCAL_WHISPER_MODEL_NAMES: [&str; 2] = ["ggml-tiny.en.bin", "ggml-base.en.bin"];
const LOCAL_WHISPER_VAD_MODEL_NAME: &str = "ggml-silero-v5.1.2.bin";
const LOCAL_PIPER_DIR_NAME: &str = "piper-voice";
const LOCAL_PIPER_MODEL_NAME: &str = "en_US-ryan-high.onnx";
const MAX_TEXT_FILE_BYTES: u64 = 256 * 1024;
const MAX_TEXT_RESPONSE_CHARS: usize = 12_000;
const MAX_TEXT_CREATE_CHARS: usize = 12_000;
const MAX_TEXT_APPEND_CHARS: usize = 12_000;
const MAX_WEBPAGE_RESPONSE_CHARS: usize = 16_000;
const MAX_DEEP_RESEARCH_PAGE_CHARS: usize = 5_000;
const MAX_AI_OUTPUT_TOKENS: u16 = 220;
const AI_REQUEST_TIMEOUT_SECONDS: u64 = 12;
const CONVERSATION_TEMPERATURE: f32 = 0.72;
const DEFAULT_OPENAI_STT_MODEL: &str = "gpt-4o-mini-transcribe";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AIMessageInput {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AIGenerateRequest {
    messages: Vec<AIMessageInput>,
    system_prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AIGenerateResponse {
    text: String,
    provider: String,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AIProviderStatus {
    configured: bool,
    provider: Option<String>,
    model: Option<String>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAIProviderConfigRequest {
    provider: String,
    api_key: String,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSTTProviderConfigRequest {
    provider: String,
    api_key: String,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AITranscribeAudioRequest {
    data_base64: String,
    mime_type: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAIProviderConfig {
    provider: String,
    api_key: String,
    model: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSTTProviderConfig {
    provider: String,
    api_key: String,
    model: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum STTProviderKind {
    OpenAI,
    Gemini,
}

#[derive(Debug)]
struct STTProviderConfig {
    provider: STTProviderKind,
    api_key: String,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct STTProviderStatus {
    configured: bool,
    provider: Option<String>,
    model: Option<String>,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AIStreamEvent {
    request_id: String,
    event_type: String,
    content: Option<String>,
    error: Option<String>,
    provider: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenApplicationRequest {
    app_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendNotificationRequest {
    title: Option<String>,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListDirectoryRequest {
    path: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TreeDirectoryRequest {
    path: String,
    depth: Option<usize>,
    limit: Option<usize>,
}

#[derive(Default)]
struct FolderSummary {
    file_count: usize,
    folder_count: usize,
    total_bytes: u64,
    scanned_items: usize,
    skipped_items: usize,
    truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFolderRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTextFileRequest {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendTextFileRequest {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenamePathRequest {
    path: String,
    new_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MovePathRequest {
    path: String,
    destination_folder: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyPathRequest {
    path: String,
    destination_folder: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevealPathRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFilesRequest {
    path: String,
    query: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTextRequest {
    path: String,
    query: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadTextFileRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteClipboardRequest {
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeakTextRequest {
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveVoiceConfigRequest {
    voice: String,
    rate: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredVoiceConfig {
    voice: String,
    rate: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceConfigStatus {
    voice: String,
    rate: u16,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenUrlRequest {
    target: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadUrlRequest {
    target: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchWebRequest {
    query: String,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeepResearchWebRequest {
    query: String,
    limit: Option<usize>,
}

#[derive(Debug)]
struct SearchResult {
    title: String,
    url: String,
}

#[derive(Debug, Clone, Copy)]
enum AIProviderKind {
    Gemini,
    OpenAI,
    OpenRouter,
    Groq,
}

#[derive(Debug, Clone)]
struct AIProviderConfig {
    provider: AIProviderKind,
    api_key: String,
    model: String,
}

impl AIProviderKind {
    fn provider_name(self) -> &'static str {
        match self {
            AIProviderKind::Gemini => "gemini",
            AIProviderKind::OpenAI => "openai",
            AIProviderKind::OpenRouter => "openrouter",
            AIProviderKind::Groq => "groq",
        }
    }

}

impl AIProviderConfig {
    fn provider_name(&self) -> &'static str {
        self.provider.provider_name()
    }
}

fn extract_response_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Some(text.to_owned());
    }

    let output = value.get("output")?.as_array()?;
    let mut text = String::new();

    for item in output {
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            continue;
        };

        for part in content {
            if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                text.push_str(part_text);
            }
        }
    }

    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn build_openai_input(request: &AIGenerateRequest) -> Vec<Value> {
    let mut input = vec![json!({
        "role": "system",
        "content": request.system_prompt,
    })];

    input.extend(request.messages.iter().map(|message| {
        json!({
            "role": message.role,
            "content": message.content,
        })
    }));

    input
}

fn build_chat_messages(request: &AIGenerateRequest) -> Vec<Value> {
    let mut messages = vec![json!({
        "role": "system",
        "content": request.system_prompt,
    })];

    messages.extend(request.messages.iter().map(|message| {
        json!({
            "role": message.role,
            "content": message.content,
        })
    }));

    messages
}

fn ai_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(AI_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("Unable to prepare AI client: {error}"))
}

#[tauri::command]
async fn ai_generate_response(request: AIGenerateRequest) -> Result<AIGenerateResponse, String> {
    match detect_provider_config().map(|config| config.provider) {
        Some(AIProviderKind::Gemini) => generate_gemini_response(request).await,
        Some(AIProviderKind::OpenAI) => generate_openai_response(request).await,
        Some(AIProviderKind::OpenRouter) => generate_openrouter_response(request).await,
        Some(AIProviderKind::Groq) => generate_groq_response(request).await,
        None => Err("No AI provider is configured. Save a Groq, Gemini, OpenAI, or OpenRouter API key once to activate FRIDAY.".to_owned()),
    }
}

#[tauri::command]
fn ai_provider_status() -> AIProviderStatus {
    match detect_provider_config() {
        Some(config) => {
            let provider_name = config.provider_name().to_owned();
            let model = config.model;

            AIProviderStatus {
                configured: true,
                provider: Some(provider_name.clone()),
                model: Some(model.clone()),
                message: format!("FRIDAY is using {provider_name} with model {model}."),
            }
        }
        None => AIProviderStatus {
            configured: false,
            provider: None,
            model: None,
            message: "No AI provider is configured. Save a Groq, Gemini, OpenAI, or OpenRouter API key once to activate FRIDAY.".to_owned(),
        },
    }
}

#[tauri::command]
fn ai_save_provider_config(request: SaveAIProviderConfigRequest) -> Result<AIProviderStatus, String> {
    let config = save_stored_ai_config(request)?;
    let provider_name = config.provider_name().to_owned();
    let model = config.model;

    Ok(AIProviderStatus {
        configured: true,
        provider: Some(provider_name.clone()),
        model: Some(model.clone()),
        message: format!("Saved {provider_name} for FRIDAY with model {model}."),
    })
}

#[tauri::command]
fn ai_stt_provider_status() -> STTProviderStatus {
    if local_whisper_is_available() {
        return STTProviderStatus {
            configured: true,
            provider: Some("local-whisper".to_owned()),
            model: find_local_whisper_model()
                .and_then(|path| path.file_name().map(|name| name.to_string_lossy().to_string())),
            message: "FRIDAY voice input is using local Whisper.".to_owned(),
        };
    }

    match detect_stt_provider_config() {
        Some(config) => {
            let provider_name = config.provider_name().to_owned();
            let model = config.model;

            STTProviderStatus {
                configured: true,
                provider: Some(provider_name.clone()),
                model: Some(model.clone()),
                message: format!("FRIDAY voice input is using {provider_name} with model {model}."),
            }
        }
        None => STTProviderStatus {
            configured: false,
            provider: None,
            model: None,
            message: "Voice input needs local Whisper installed, or an optional OpenAI/Gemini speech-to-text key.".to_owned(),
        },
    }
}

#[tauri::command]
fn ai_save_stt_provider_config(request: SaveSTTProviderConfigRequest) -> Result<STTProviderStatus, String> {
    let config = save_stored_stt_config(request)?;
    let provider_name = config.provider_name().to_owned();
    let model = config.model;

    Ok(STTProviderStatus {
        configured: true,
        provider: Some(provider_name.clone()),
        model: Some(model.clone()),
        message: format!("Saved {provider_name} for FRIDAY voice input with model {model}."),
    })
}

#[tauri::command]
async fn ai_transcribe_audio(request: AITranscribeAudioRequest) -> Result<String, String> {
    transcribe_audio(request).await
}

#[tauri::command]
async fn ai_stream_response(
    window: Window,
    request_id: String,
    request: AIGenerateRequest,
) -> Result<(), String> {
    let result = match detect_provider_config().map(|config| config.provider) {
        Some(AIProviderKind::Gemini) => stream_gemini_response(&window, &request_id, request).await,
        Some(AIProviderKind::OpenAI) => stream_openai_response(&window, &request_id, request).await,
        Some(AIProviderKind::OpenRouter) => stream_openrouter_response(&window, &request_id, request).await,
        Some(AIProviderKind::Groq) => stream_groq_response(&window, &request_id, request).await,
        None => Err("No AI provider is configured. Save a Groq, Gemini, OpenAI, or OpenRouter API key once to activate FRIDAY.".to_owned()),
    };

    match result {
        Ok(()) => emit_stream_event(&window, &request_id, "done", None, None),
        Err(error) => {
            emit_stream_event(&window, &request_id, "error", None, Some(error.clone()))?;
            Err(error)
        }
    }
}

#[tauri::command]
fn desktop_open_application(request: OpenApplicationRequest) -> Result<String, String> {
    let app_name = request.app_name.trim();

    validate_app_name(app_name)?;

    open_application_by_name(app_name)?;
    Ok(format!("Opening {app_name}."))
}

#[tauri::command]
fn desktop_quit_application(request: OpenApplicationRequest) -> Result<String, String> {
    let app_name = request.app_name.trim();

    validate_app_name(app_name)?;
    quit_application_by_name(app_name)?;

    Ok(format!("Asked {app_name} to quit."))
}

#[tauri::command]
fn desktop_focus_application(request: OpenApplicationRequest) -> Result<String, String> {
    let app_name = request.app_name.trim();

    validate_app_name(app_name)?;
    focus_application_by_name(app_name)?;

    Ok(format!("Focused {app_name}."))
}

#[tauri::command]
fn desktop_list_applications() -> Result<String, String> {
    list_applications()
}

#[tauri::command]
fn desktop_system_status() -> Result<String, String> {
    let mut lines = vec![
        "System status:".to_owned(),
        format!("OS: {}", std::env::consts::OS),
        format!("Architecture: {}", std::env::consts::ARCH),
        format!("Current time: {:?}", SystemTime::now()),
    ];

    match read_battery_status() {
        Ok(status) => lines.push(format!("Battery: {status}")),
        Err(error) => lines.push(format!("Battery: unavailable ({error})")),
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
fn desktop_list_processes() -> Result<String, String> {
    list_processes()
}

#[tauri::command]
fn desktop_network_status() -> Result<String, String> {
    read_network_status()
}

#[tauri::command]
fn desktop_storage_status() -> Result<String, String> {
    read_storage_status()
}

#[tauri::command]
fn desktop_active_window() -> Result<String, String> {
    read_active_window()
}

#[tauri::command]
fn desktop_list_windows() -> Result<String, String> {
    list_open_windows()
}

#[tauri::command]
fn desktop_send_notification(request: SendNotificationRequest) -> Result<String, String> {
    send_desktop_notification(request)
}

#[tauri::command]
fn desktop_list_directory(request: ListDirectoryRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let limit = request.limit.unwrap_or(40).clamp(1, 100);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }

    let mut entries = fs::read_dir(&path)
        .map_err(|error| format!("I could not open {}: {error}", path.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.starts_with('.') {
                return None;
            }

            let entry_type = entry.file_type().ok()?;
            let marker = if entry_type.is_dir() { "folder" } else { "file" };
            Some(format!("- {file_name} ({marker})"))
        })
        .collect::<Vec<_>>();

    entries.sort();

    if entries.is_empty() {
        return Ok(format!("{} is empty.", path.display()));
    }

    let remaining = entries.len().saturating_sub(limit);
    let mut lines = vec![format!("Contents of {}:", path.display()), String::new()];
    lines.extend(entries.into_iter().take(limit));

    if remaining > 0 {
        lines.push(format!("...and {remaining} more items."));
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
fn desktop_tree_directory(request: TreeDirectoryRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let max_depth = request.depth.unwrap_or(3).clamp(1, 5);
    let limit = request.limit.unwrap_or(120).clamp(1, 300);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }

    let mut lines = vec![
        format!("Folder tree for {}:", path.display()),
        ".".to_owned(),
    ];
    let mut visited = 0;
    build_directory_tree(&path, "", 0, max_depth, limit, &mut visited, &mut lines);

    if visited >= limit {
        lines.push(format!("...truncated after {limit} items."));
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
fn desktop_folder_summary(request: TreeDirectoryRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let max_depth = request.depth.unwrap_or(5).clamp(1, 8);
    let limit = request.limit.unwrap_or(5_000).clamp(1, 20_000);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }

    let mut summary = FolderSummary::default();
    summarize_directory(&path, 0, max_depth, limit, &mut summary);

    let mut lines = vec![
        format!("Folder summary for {}:", path.display()),
        format!("Folders: {}", summary.folder_count),
        format!("Files: {}", summary.file_count),
        format!("Estimated total size: {}", format_byte_size(summary.total_bytes)),
        format!("Scanned items: {}", summary.scanned_items),
    ];

    if summary.skipped_items > 0 {
        lines.push(format!("Skipped items: {}", summary.skipped_items));
    }

    if summary.truncated {
        lines.push(format!(
            "Scan truncated at depth {max_depth} or after {limit} items."
        ));
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
fn desktop_path_info(request: RevealPathRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read metadata for {}: {error}", path.display()))?;
    let kind = if metadata.is_dir() {
        "folder"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    };

    let mut lines = vec![
        "Path info:".to_owned(),
        format!("Path: {}", path.display()),
        format!("Type: {kind}"),
        format!("Size: {}", format_byte_size(metadata.len())),
        format!("Readonly: {}", metadata.permissions().readonly()),
    ];

    if let Ok(modified) = metadata.modified() {
        lines.push(format!("Modified: {}", format_system_time(modified)));
    }

    if let Ok(created) = metadata.created() {
        lines.push(format!("Created: {}", format_system_time(created)));
    }

    if let Ok(accessed) = metadata.accessed() {
        lines.push(format!("Accessed: {}", format_system_time(accessed)));
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
fn desktop_create_folder(request: CreateFolderRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;

    if path.exists() {
        return Err(format!("{} already exists.", path.display()));
    }

    let Some(parent) = path.parent() else {
        return Err("That folder path is not valid.".to_owned());
    };

    if !parent.exists() {
        return Err(format!("Parent folder does not exist: {}", parent.display()));
    }

    fs::create_dir(&path)
        .map_err(|error| format!("I could not create {}: {error}", path.display()))?;

    Ok(format!("Created folder:\n{}", path.display()))
}

#[tauri::command]
fn desktop_create_text_file(request: CreateTextFileRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;

    if path.exists() {
        return Err(format!("{} already exists.", path.display()));
    }

    let Some(parent) = path.parent() else {
        return Err("That file path is not valid.".to_owned());
    };

    if !parent.exists() {
        return Err(format!("Parent folder does not exist: {}", parent.display()));
    }

    if !is_allowed_text_file(&path) {
        return Err(
            "I can only create safe text files right now: txt, md, json, csv, log, yaml, yml, toml, rs, ts, tsx, js, jsx, css, html."
                .to_owned(),
        );
    }

    let char_count = request.content.chars().count();
    if char_count > MAX_TEXT_CREATE_CHARS {
        return Err(format!(
            "That file is too large to create safely. Current limit is {} characters.",
            MAX_TEXT_CREATE_CHARS,
        ));
    }

    fs::write(&path, request.content)
        .map_err(|error| format!("I could not create {}: {error}", path.display()))?;

    Ok(format!("Created text file:\n{}", path.display()))
}

#[tauri::command]
fn desktop_append_text_file(request: AppendTextFileRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;

    if !metadata.is_file() {
        return Err(format!("{} is not a file.", path.display()));
    }

    if !is_allowed_text_file(&path) {
        return Err(
            "I can only append to safe text files right now: txt, md, json, csv, log, yaml, yml, toml, rs, ts, tsx, js, jsx, css, html."
                .to_owned(),
        );
    }

    let char_count = request.content.chars().count();
    if char_count > MAX_TEXT_APPEND_CHARS {
        return Err(format!(
            "That text is too large to append safely. Current limit is {} characters.",
            MAX_TEXT_APPEND_CHARS,
        ));
    }

    let separator = if metadata.len() > 0 && !request.content.starts_with('\n') {
        "\n"
    } else {
        ""
    };
    let added_bytes = separator.len() as u64 + request.content.as_bytes().len() as u64;

    if metadata.len().saturating_add(added_bytes) > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "Appending that text would make {} larger than the safe limit of {} KB.",
            path.display(),
            MAX_TEXT_FILE_BYTES / 1024,
        ));
    }

    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|error| format!("I could not open {} for appending: {error}", path.display()))?;

    file.write_all(separator.as_bytes())
        .and_then(|_| file.write_all(request.content.as_bytes()))
        .map_err(|error| format!("I could not append to {}: {error}", path.display()))?;

    Ok(format!("Appended text to:\n{}", path.display()))
}

#[tauri::command]
fn desktop_rename_path(request: RenamePathRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let new_name = request.new_name.trim();

    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }

    if !is_safe_file_name(new_name) {
        return Err("Rename target must be a simple file or folder name, not a path.".to_owned());
    }

    let Some(parent) = path.parent() else {
        return Err("That path cannot be renamed safely.".to_owned());
    };

    let target = parent.join(new_name);
    if target.exists() {
        return Err(format!("{} already exists.", target.display()));
    }

    fs::rename(&path, &target)
        .map_err(|error| format!("I could not rename {}: {error}", path.display()))?;

    Ok(format!(
        "Renamed:\n{}\n\nto:\n{}",
        path.display(),
        target.display(),
    ))
}

#[tauri::command]
fn desktop_move_path(request: MovePathRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let destination_folder = resolve_user_path(&request.destination_folder)?;

    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }

    let destination_metadata = fs::metadata(&destination_folder)
        .map_err(|error| format!("I could not read destination {}: {error}", destination_folder.display()))?;

    if !destination_metadata.is_dir() {
        return Err(format!("{} is not a folder.", destination_folder.display()));
    }

    let Some(file_name) = path.file_name() else {
        return Err("That path cannot be moved safely.".to_owned());
    };

    let target = destination_folder.join(file_name);
    if target.exists() {
        return Err(format!("{} already exists.", target.display()));
    }

    fs::rename(&path, &target)
        .map_err(|error| format!("I could not move {}: {error}", path.display()))?;

    Ok(format!(
        "Moved:\n{}\n\nto:\n{}",
        path.display(),
        target.display(),
    ))
}

#[tauri::command]
fn desktop_copy_path(request: CopyPathRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let destination_folder = resolve_user_path(&request.destination_folder)?;

    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;
    let destination_metadata = fs::metadata(&destination_folder)
        .map_err(|error| format!("I could not read destination {}: {error}", destination_folder.display()))?;

    if !destination_metadata.is_dir() {
        return Err(format!("{} is not a folder.", destination_folder.display()));
    }

    if metadata.is_dir() {
        let source = fs::canonicalize(&path)
            .map_err(|error| format!("I could not resolve {}: {error}", path.display()))?;
        let destination = fs::canonicalize(&destination_folder)
            .map_err(|error| format!("I could not resolve {}: {error}", destination_folder.display()))?;

        if destination.starts_with(&source) {
            return Err("I cannot copy a folder into itself or one of its subfolders.".to_owned());
        }
    }

    let Some(file_name) = path.file_name() else {
        return Err("That path cannot be copied safely.".to_owned());
    };

    let target = destination_folder.join(file_name);
    if target.exists() {
        return Err(format!("{} already exists.", target.display()));
    }

    copy_path_no_overwrite(&path, &target)
        .map_err(|error| format!("I could not copy {}: {error}", path.display()))?;

    Ok(format!(
        "Copied:\n{}\n\nto:\n{}",
        path.display(),
        target.display(),
    ))
}

#[tauri::command]
fn desktop_trash_path(request: RevealPathRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;

    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }

    let status = Command::new("osascript")
        .arg("-e")
        .arg("on run argv")
        .arg("-e")
        .arg("tell application \"Finder\" to delete POSIX file (item 1 of argv)")
        .arg("-e")
        .arg("end run")
        .arg(path.to_string_lossy().to_string())
        .status()
        .map_err(|error| format!("I could not ask Finder to move {} to Trash: {error}", path.display()))?;

    if !status.success() {
        return Err(format!("Finder could not move {} to Trash.", path.display()));
    }

    Ok(format!("Moved to Trash:\n{}", path.display()))
}

#[tauri::command]
fn desktop_reveal_path(request: RevealPathRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;

    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }

    let status = Command::new("open")
        .arg("-R")
        .arg(&path)
        .status()
        .map_err(|error| format!("I could not ask Finder to reveal {}: {error}", path.display()))?;

    if !status.success() {
        return Err(format!("Finder could not reveal {}.", path.display()));
    }

    Ok(format!("Revealed in Finder:\n{}", path.display()))
}

#[tauri::command]
fn desktop_open_path(request: RevealPathRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;

    if !path.exists() {
        return Err(format!("{} does not exist.", path.display()));
    }

    let status = Command::new("open")
        .arg(&path)
        .status()
        .map_err(|error| format!("I could not open {}: {error}", path.display()))?;

    if !status.success() {
        return Err(format!("macOS could not open {}.", path.display()));
    }

    Ok(format!("Opened:\n{}", path.display()))
}

#[tauri::command]
fn desktop_search_files(request: SearchFilesRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let query = request.query.trim().to_lowercase();
    let limit = request.limit.unwrap_or(30).clamp(1, 100);

    if query.len() < 2 {
        return Err("Search query must be at least 2 characters.".to_owned());
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }

    let mut matches = Vec::new();
    search_files_recursive(&path, &query, limit, 0, &mut matches);

    if matches.is_empty() {
        return Ok(format!("No filenames matching \"{}\" were found in {}.", request.query, path.display()));
    }

    let mut lines = vec![
        format!("Found {} result{} for \"{}\":", matches.len(), if matches.len() == 1 { "" } else { "s" }, request.query),
        String::new(),
    ];
    lines.extend(matches.into_iter().map(|path| format!("- {}", path.display())));

    Ok(lines.join("\n"))
}

#[tauri::command]
fn desktop_search_text(request: SearchTextRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let query = request.query.trim().to_lowercase();
    let limit = request.limit.unwrap_or(30).clamp(1, 80);

    if query.len() < 2 {
        return Err("Search text must be at least 2 characters.".to_owned());
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;

    if !metadata.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }

    let mut matches = Vec::new();
    search_text_recursive(&path, &query, limit, 0, &mut matches);

    if matches.is_empty() {
        return Ok(format!("No text matching \"{}\" was found in safe text files under {}.", request.query, path.display()));
    }

    let mut lines = vec![
        format!("Found {} text match{} for \"{}\":", matches.len(), if matches.len() == 1 { "" } else { "es" }, request.query),
        String::new(),
    ];
    lines.extend(matches.into_iter().map(|match_line| format!("- {match_line}")));

    Ok(lines.join("\n"))
}

#[tauri::command]
fn desktop_read_text_file(request: ReadTextFileRequest) -> Result<String, String> {
    let path = resolve_user_path(&request.path)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("I could not read {}: {error}", path.display()))?;

    if !metadata.is_file() {
        return Err(format!("{} is not a file.", path.display()));
    }

    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "{} is too large to read safely. Current limit is {} KB.",
            path.display(),
            MAX_TEXT_FILE_BYTES / 1024,
        ));
    }

    if !is_allowed_text_file(&path) {
        return Err(
            "I can only read safe text files right now: txt, md, json, csv, log, yaml, yml, toml, rs, ts, tsx, js, jsx, css, html."
                .to_owned(),
        );
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("I could not decode {} as text: {error}", path.display()))?;
    let char_count = content.chars().count();
    let preview = if char_count > MAX_TEXT_RESPONSE_CHARS {
        format!(
            "{}\n\n...truncated after {} characters.",
            content.chars().take(MAX_TEXT_RESPONSE_CHARS).collect::<String>(),
            MAX_TEXT_RESPONSE_CHARS,
        )
    } else {
        content
    };

    Ok([
        format!("Contents of {}:", path.display()),
        String::new(),
        preview,
    ].join("\n"))
}

#[tauri::command]
fn desktop_read_clipboard() -> Result<String, String> {
    let text = read_clipboard_text()?;

    if text.trim().is_empty() {
        return Ok("The clipboard is empty or does not contain readable text.".to_owned());
    }

    Ok([
        "Clipboard text:".to_owned(),
        String::new(),
        text,
    ].join("\n"))
}

#[tauri::command]
fn desktop_write_clipboard(request: WriteClipboardRequest) -> Result<String, String> {
    let text = request.text;

    if text.chars().count() > 8_000 {
        return Err("That text is too long for the clipboard tool right now.".to_owned());
    }

    write_clipboard_text(&text)?;
    Ok("Copied that to the clipboard.".to_owned())
}

#[tauri::command]
fn desktop_capture_screen() -> Result<String, String> {
    let path = capture_screen()?;

    Ok(format!(
        "Captured the screen and saved it here:\n{}",
        path.display()
    ))
}

#[tauri::command]
fn desktop_speak_text(request: SpeakTextRequest) -> Result<String, String> {
    speak_text(&request.text)
}

#[tauri::command]
fn voice_save_config(request: SaveVoiceConfigRequest) -> Result<VoiceConfigStatus, String> {
    let config = save_voice_config(request)?;

    Ok(VoiceConfigStatus {
        voice: config.voice.clone(),
        rate: config.rate,
        message: format!("FRIDAY voice is now {} at rate {}.", config.voice, config.rate),
    })
}

#[tauri::command]
fn desktop_open_url(request: OpenUrlRequest) -> Result<String, String> {
    let url = normalize_url(&request.target)?;
    open_url(&url)?;

    Ok(format!("Opening {url}."))
}

#[tauri::command]
async fn desktop_read_url(request: ReadUrlRequest) -> Result<String, String> {
    let url = normalize_url(&request.target)?;
    let text = fetch_readable_webpage(&url).await?;

    Ok([
        format!("Readable text from {url}:"),
        String::new(),
        text,
    ].join("\n"))
}

#[tauri::command]
async fn desktop_research_web(request: ResearchWebRequest) -> Result<String, String> {
    let query = request.query.trim();
    let limit = request.limit.unwrap_or(5).clamp(1, 8);

    if query.len() < 2 {
        return Err("Tell me what to research.".to_owned());
    }

    let results = fetch_search_results(query, limit).await?;

    if results.is_empty() {
        return Ok(format!("I could not find public search results for \"{query}\"."));
    }

    let mut lines = vec![
        format!("Research results for \"{query}\":"),
        String::new(),
    ];

    lines.extend(results.into_iter().enumerate().map(|(index, result)| {
        format!("{}. {}\n   {}", index + 1, result.title, result.url)
    }));

    Ok(lines.join("\n"))
}

#[tauri::command]
async fn desktop_deep_research_web(request: DeepResearchWebRequest) -> Result<String, String> {
    let query = request.query.trim();
    let limit = request.limit.unwrap_or(3).clamp(1, 3);

    if query.len() < 2 {
        return Err("Tell me what to research deeply.".to_owned());
    }

    let results = fetch_search_results(query, limit + 2).await?;

    if results.is_empty() {
        return Ok(format!("I could not find public search results for \"{query}\"."));
    }

    let mut lines = vec![
        format!("Deep research context for \"{query}\":"),
        "Use this as source context. Some pages may be partially truncated.".to_owned(),
        String::new(),
    ];
    let mut pages_read = 0;

    for result in results {
        if pages_read >= limit {
            break;
        }

        match fetch_readable_webpage(&result.url).await {
            Ok(text) => {
                pages_read += 1;
                lines.push(format!("Source {pages_read}: {}", result.title));
                lines.push(result.url);
                lines.push(String::new());
                lines.push(truncate_chars(&text, MAX_DEEP_RESEARCH_PAGE_CHARS));
                lines.push(String::new());
            }
            Err(error) => {
                lines.push(format!("Skipped: {}", result.title));
                lines.push(result.url);
                lines.push(format!("Reason: {error}"));
                lines.push(String::new());
            }
        }
    }

    if pages_read == 0 {
        return Err("I found results, but could not read any of the public pages.".to_owned());
    }

    Ok(lines.join("\n"))
}

fn resolve_user_path(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed_path = raw_path.trim();
    if trimmed_path.is_empty() {
        return Err("Tell me which folder to inspect.".to_owned());
    }

    if trimmed_path == "~" || trimmed_path.starts_with("~/") {
        let home = std::env::var("HOME")
            .map_err(|_| "I could not resolve your home folder.".to_owned())?;
        let suffix = trimmed_path.strip_prefix("~/").unwrap_or("");
        return Ok(Path::new(&home).join(suffix));
    }

    Ok(PathBuf::from(trimmed_path))
}

fn format_byte_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit_index = 0;

    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{bytes} {}", UNITS[unit_index])
    } else {
        format!("{size:.1} {}", UNITS[unit_index])
    }
}

fn format_system_time(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{} unix seconds", duration.as_secs()),
        Err(_) => "before unix epoch".to_owned(),
    }
}

fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains(':')
}

fn copy_path_no_overwrite(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        return Err(format!("{} already exists.", target.display()));
    }

    let metadata = fs::metadata(source)
        .map_err(|error| format!("I could not read {}: {error}", source.display()))?;

    if metadata.is_file() {
        fs::copy(source, target)
            .map(|_| ())
            .map_err(|error| format!("copy failed: {error}"))?;
        return Ok(());
    }

    if metadata.is_dir() {
        fs::create_dir(target)
            .map_err(|error| format!("I could not create {}: {error}", target.display()))?;

        let entries = fs::read_dir(source)
            .map_err(|error| format!("I could not read {}: {error}", source.display()))?;

        for entry in entries {
            let entry = entry
                .map_err(|error| format!("I could not read an item in {}: {error}", source.display()))?;
            let entry_source = entry.path();
            let entry_target = target.join(entry.file_name());
            copy_path_no_overwrite(&entry_source, &entry_target)?;
        }

        return Ok(());
    }

    Err("I can only copy regular files and folders.".to_owned())
}

fn is_allowed_text_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };

    matches!(
        extension.to_lowercase().as_str(),
        "txt"
            | "md"
            | "json"
            | "csv"
            | "log"
            | "yaml"
            | "yml"
            | "toml"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "css"
            | "html"
    )
}

fn search_files_recursive(
    path: &Path,
    query: &str,
    limit: usize,
    depth: usize,
    matches: &mut Vec<PathBuf>,
) {
    if matches.len() >= limit || depth > 5 {
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        if matches.len() >= limit {
            return;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }

        let entry_path = entry.path();
        if file_name.to_lowercase().contains(query) {
            matches.push(entry_path.clone());
        }

        if entry.file_type().map(|file_type| file_type.is_dir()).unwrap_or(false) {
            search_files_recursive(&entry_path, query, limit, depth + 1, matches);
        }
    }
}

fn build_directory_tree(
    path: &Path,
    prefix: &str,
    depth: usize,
    max_depth: usize,
    limit: usize,
    visited: &mut usize,
    lines: &mut Vec<String>,
) {
    if depth >= max_depth || *visited >= limit {
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    let mut entries = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.starts_with('.') {
                return None;
            }

            let file_type = entry.file_type().ok()?;
            Some((file_name, entry.path(), file_type.is_dir()))
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        right.2.cmp(&left.2).then_with(|| left.0.to_lowercase().cmp(&right.0.to_lowercase()))
    });

    let entry_count = entries.len();

    for (index, (file_name, entry_path, is_dir)) in entries.into_iter().enumerate() {
        if *visited >= limit {
            return;
        }

        *visited += 1;

        let is_last = index + 1 == entry_count;
        let branch = if is_last { "`- " } else { "|- " };
        let marker = if is_dir { "/" } else { "" };
        lines.push(format!("{prefix}{branch}{file_name}{marker}"));

        if is_dir {
            let next_prefix = format!("{prefix}{}", if is_last { "   " } else { "|  " });
            build_directory_tree(&entry_path, &next_prefix, depth + 1, max_depth, limit, visited, lines);
        }
    }
}

fn summarize_directory(
    path: &Path,
    depth: usize,
    max_depth: usize,
    limit: usize,
    summary: &mut FolderSummary,
) {
    if depth >= max_depth || summary.scanned_items >= limit {
        summary.truncated = true;
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        summary.skipped_items += 1;
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        if summary.scanned_items >= limit {
            summary.truncated = true;
            return;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            summary.skipped_items += 1;
            continue;
        };

        summary.scanned_items += 1;

        if metadata.is_dir() {
            summary.folder_count += 1;
            summarize_directory(&entry.path(), depth + 1, max_depth, limit, summary);
        } else if metadata.is_file() {
            summary.file_count += 1;
            summary.total_bytes = summary.total_bytes.saturating_add(metadata.len());
        } else {
            summary.skipped_items += 1;
        }
    }
}

fn search_text_recursive(
    path: &Path,
    query: &str,
    limit: usize,
    depth: usize,
    matches: &mut Vec<String>,
) {
    if matches.len() >= limit || depth > 5 {
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        if matches.len() >= limit {
            return;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }

        let entry_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            search_text_recursive(&entry_path, query, limit, depth + 1, matches);
            continue;
        }

        if !file_type.is_file() || !is_allowed_text_file(&entry_path) {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.len() > MAX_TEXT_FILE_BYTES {
            continue;
        }

        let Ok(content) = fs::read_to_string(&entry_path) else {
            continue;
        };

        for (line_index, line) in content.lines().enumerate() {
            if matches.len() >= limit {
                return;
            }

            if line.to_lowercase().contains(query) {
                let preview = line.trim();
                let preview = if preview.chars().count() > 160 {
                    format!("{}...", preview.chars().take(160).collect::<String>())
                } else {
                    preview.to_owned()
                };

                matches.push(format!("{}:{}: {}", entry_path.display(), line_index + 1, preview));
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn open_application_by_name(app_name: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg("-a")
        .arg(app_name)
        .status()
        .map_err(|error| format!("Unable to open {app_name}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("I could not open {app_name}."))
    }
}

fn validate_app_name(app_name: &str) -> Result<(), String> {
    if app_name.is_empty() {
        return Err("Tell me which app to control.".to_owned());
    }

    if app_name.len() > 80 {
        return Err("That app name is too long.".to_owned());
    }

    if !app_name
        .chars()
        .all(|character| character.is_alphanumeric() || matches!(character, ' ' | '-' | '_' | '.'))
    {
        return Err("That app name contains unsupported characters.".to_owned());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn quit_application_by_name(app_name: &str) -> Result<(), String> {
    let script = r#"
on run argv
  set appName to item 1 of argv
  tell application appName to quit
end run
"#;

    let status = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(app_name)
        .status()
        .map_err(|error| format!("Unable to quit {app_name}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("I could not quit {app_name}."))
    }
}

#[cfg(target_os = "macos")]
fn focus_application_by_name(app_name: &str) -> Result<(), String> {
    let script = r#"
on run argv
  set appName to item 1 of argv
  tell application appName to activate
end run
"#;

    let status = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(app_name)
        .status()
        .map_err(|error| format!("Unable to focus {app_name}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("I could not focus {app_name}."))
    }
}

#[cfg(not(target_os = "macos"))]
fn focus_application_by_name(_app_name: &str) -> Result<(), String> {
    Err("Focusing applications is currently implemented for macOS only.".to_owned())
}

#[cfg(not(target_os = "macos"))]
fn quit_application_by_name(_app_name: &str) -> Result<(), String> {
    Err("Quitting applications is currently implemented for macOS only.".to_owned())
}

#[cfg(not(target_os = "macos"))]
fn open_application_by_name(_app_name: &str) -> Result<(), String> {
    Err("Opening applications is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn list_applications() -> Result<String, String> {
    let mut apps = Vec::new();
    let mut roots = vec![PathBuf::from("/Applications")];

    if let Ok(home) = std::env::var("HOME") {
        roots.push(Path::new(&home).join("Applications"));
    }

    for root in roots {
        if !root.exists() {
            continue;
        }

        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };

        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
                continue;
            };

            if extension != "app" {
                continue;
            }

            let Some(name) = path.file_stem().and_then(|name| name.to_str()) else {
                continue;
            };

            apps.push(name.to_owned());
        }
    }

    apps.sort();
    apps.dedup();

    if apps.is_empty() {
        return Ok("I could not find installed applications.".to_owned());
    }

    let remaining = apps.len().saturating_sub(80);
    let mut lines = vec!["Installed applications:".to_owned(), String::new()];
    lines.extend(apps.into_iter().take(80).map(|app| format!("- {app}")));

    if remaining > 0 {
        lines.push(format!("...and {remaining} more apps."));
    }

    Ok(lines.join("\n"))
}

#[cfg(not(target_os = "macos"))]
fn list_applications() -> Result<String, String> {
    Err("Application discovery is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn read_battery_status() -> Result<String, String> {
    let output = Command::new("pmset")
        .arg("-g")
        .arg("batt")
        .output()
        .map_err(|error| format!("Unable to read battery: {error}"))?;

    if !output.status.success() {
        return Err("pmset did not return battery information.".to_owned());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    Ok(compact_whitespace(&text))
}

#[cfg(not(target_os = "macos"))]
fn read_battery_status() -> Result<String, String> {
    Err("battery status is currently implemented for macOS only".to_owned())
}

#[cfg(target_os = "macos")]
fn list_processes() -> Result<String, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid,comm", "-r"])
        .output()
        .map_err(|error| format!("Unable to list processes: {error}"))?;

    if !output.status.success() {
        return Err("Process listing failed.".to_owned());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = vec!["Running processes:".to_owned(), String::new()];
    lines.extend(
        text
            .lines()
            .skip(1)
            .take(30)
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }

                Some(format!("- {trimmed}"))
            }),
    );

    Ok(lines.join("\n"))
}

#[cfg(not(target_os = "macos"))]
fn list_processes() -> Result<String, String> {
    Err("Process listing is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn read_network_status() -> Result<String, String> {
    let mut lines = vec!["Network status:".to_owned()];

    let wifi_output = Command::new("networksetup")
        .args(["-getairportnetwork", "en0"])
        .output();

    match wifi_output {
        Ok(output) if output.status.success() => {
            let wifi = compact_whitespace(&String::from_utf8_lossy(&output.stdout));
            if wifi.is_empty() {
                lines.push("Wi-Fi: unavailable".to_owned());
            } else {
                lines.push(format!("Wi-Fi: {wifi}"));
            }
        }
        Ok(output) => {
            let error_text = compact_whitespace(&String::from_utf8_lossy(&output.stderr));
            if error_text.is_empty() {
                lines.push("Wi-Fi: unavailable".to_owned());
            } else {
                lines.push(format!("Wi-Fi: unavailable ({error_text})"));
            }
        }
        Err(error) => lines.push(format!("Wi-Fi: unavailable ({error})")),
    }

    let reachability_output = Command::new("scutil")
        .arg("--nwi")
        .output()
        .map_err(|error| format!("Unable to read network reachability: {error}"))?;

    if !reachability_output.status.success() {
        return Err("Network reachability check failed.".to_owned());
    }

    let reachability = String::from_utf8_lossy(&reachability_output.stdout);
    let mut details = reachability
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            let lower = line.to_lowercase();
            lower.contains("reachable")
                || lower.contains("network interfaces")
                || lower.contains("ipv4")
                || lower.contains("ipv6")
        })
        .take(8)
        .map(|line| format!("- {line}"))
        .collect::<Vec<_>>();

    if details.is_empty() {
        details.push(format!("- {}", compact_whitespace(&reachability)));
    }

    lines.push("Reachability:".to_owned());
    lines.extend(details);

    Ok(lines.join("\n"))
}

#[cfg(not(target_os = "macos"))]
fn read_network_status() -> Result<String, String> {
    Err("Network status is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn read_storage_status() -> Result<String, String> {
    let output = Command::new("df")
        .args(["-H", "/"])
        .output()
        .map_err(|error| format!("Unable to read storage status: {error}"))?;

    if !output.status.success() {
        return Err("Storage status check failed.".to_owned());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let header = lines.next().unwrap_or("").trim();
    let values = lines.next().unwrap_or("").trim();

    if header.is_empty() || values.is_empty() {
        return Err("Storage status returned no usable data.".to_owned());
    }

    let columns = values.split_whitespace().collect::<Vec<_>>();
    if columns.len() < 6 {
        return Ok(format!("Storage status:\n{}", compact_whitespace(&text)));
    }

    Ok([
        "Storage status:".to_owned(),
        format!("Filesystem: {}", columns[0]),
        format!("Total: {}", columns[1]),
        format!("Used: {}", columns[2]),
        format!("Available: {}", columns[3]),
        format!("Usage: {}", columns[4]),
        format!("Mounted at: {}", columns[5]),
    ]
    .join("\n"))
}

#[cfg(not(target_os = "macos"))]
fn read_storage_status() -> Result<String, String> {
    Err("Storage status is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn read_active_window() -> Result<String, String> {
    let script = r#"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set windowTitle to ""
  try
    if exists window 1 of frontApp then
      set windowTitle to name of window 1 of frontApp
    end if
  end try
  return appName & linefeed & windowTitle
end tell
"#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Unable to read active window: {error}"))?;

    if !output.status.success() {
        let error_text = compact_whitespace(&String::from_utf8_lossy(&output.stderr));
        if error_text.to_lowercase().contains("not allowed") {
            return Err("macOS needs Accessibility permission before FRIDAY can read the active window.".to_owned());
        }

        return Err(if error_text.is_empty() {
            "Active window check failed.".to_owned()
        } else {
            error_text
        });
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let app_name = lines.next().unwrap_or("").trim();
    let window_title = lines.next().unwrap_or("").trim();

    if app_name.is_empty() {
        return Err("I could not identify the active application.".to_owned());
    }

    let mut response = vec![
        "Active window:".to_owned(),
        format!("App: {app_name}"),
    ];

    if window_title.is_empty() {
        response.push("Window: unavailable".to_owned());
    } else {
        response.push(format!("Window: {window_title}"));
    }

    Ok(response.join("\n"))
}

#[cfg(not(target_os = "macos"))]
fn read_active_window() -> Result<String, String> {
    Err("Active window awareness is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn list_open_windows() -> Result<String, String> {
    let script = r#"
tell application "System Events"
  set outputLines to {}
  repeat with appProcess in (application processes whose visible is true)
    set appName to name of appProcess
    set windowCount to count of windows of appProcess
    if windowCount is 0 then
      set end of outputLines to appName & "|"
    else
      repeat with windowIndex from 1 to windowCount
        set windowTitle to ""
        try
          set windowTitle to name of window windowIndex of appProcess
        end try
        set end of outputLines to appName & "|" & windowTitle
      end repeat
    end if
  end repeat
  set AppleScript's text item delimiters to linefeed
  set outputText to outputLines as text
  set AppleScript's text item delimiters to ""
  return outputText
end tell
"#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Unable to list windows: {error}"))?;

    if !output.status.success() {
        let error_text = compact_whitespace(&String::from_utf8_lossy(&output.stderr));
        if error_text.to_lowercase().contains("not allowed") {
            return Err("macOS needs Accessibility permission before FRIDAY can list open windows.".to_owned());
        }

        return Err(if error_text.is_empty() {
            "Window inventory check failed.".to_owned()
        } else {
            error_text
        });
    }

    let mut entries = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }

            let mut parts = trimmed.splitn(2, '|');
            let app_name = parts.next().unwrap_or("").trim();
            let window_title = parts.next().unwrap_or("").trim();

            if app_name.is_empty() {
                return None;
            }

            if window_title.is_empty() {
                Some(format!("- {app_name}"))
            } else {
                Some(format!("- {app_name}: {window_title}"))
            }
        })
        .collect::<Vec<_>>();

    entries.sort();
    entries.dedup();

    if entries.is_empty() {
        return Ok("No visible application windows were found.".to_owned());
    }

    let remaining = entries.len().saturating_sub(30);
    let mut lines = vec!["Open windows:".to_owned(), String::new()];
    lines.extend(entries.into_iter().take(30));

    if remaining > 0 {
        lines.push(format!("...and {remaining} more windows."));
    }

    Ok(lines.join("\n"))
}

#[cfg(not(target_os = "macos"))]
fn list_open_windows() -> Result<String, String> {
    Err("Window inventory is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn send_desktop_notification(request: SendNotificationRequest) -> Result<String, String> {
    let title = request.title.unwrap_or_else(|| "FRIDAY".to_owned());
    let title = title.trim();
    let body = request.body.trim();

    if title.is_empty() {
        return Err("Notification title cannot be empty.".to_owned());
    }

    if body.is_empty() {
        return Err("Notification body cannot be empty.".to_owned());
    }

    if title.chars().count() > 80 {
        return Err("Notification title is too long.".to_owned());
    }

    if body.chars().count() > 240 {
        return Err("Notification body is too long.".to_owned());
    }

    let script = r#"
on run argv
  set notificationTitle to item 1 of argv
  set notificationBody to item 2 of argv
  display notification notificationBody with title notificationTitle
end run
"#;

    let status = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(title)
        .arg(body)
        .status()
        .map_err(|error| format!("Unable to send notification: {error}"))?;

    if status.success() {
        Ok("Notification sent.".to_owned())
    } else {
        Err("I could not send the notification.".to_owned())
    }
}

#[cfg(not(target_os = "macos"))]
fn send_desktop_notification(_request: SendNotificationRequest) -> Result<String, String> {
    Err("Desktop notifications are currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn read_clipboard_text() -> Result<String, String> {
    let output = Command::new("pbpaste")
        .output()
        .map_err(|error| format!("Unable to read clipboard: {error}"))?;

    if !output.status.success() {
        return Err("Unable to read clipboard.".to_owned());
    }

    String::from_utf8(output.stdout)
        .map_err(|_| "The clipboard does not contain valid UTF-8 text.".to_owned())
}

#[cfg(not(target_os = "macos"))]
fn read_clipboard_text() -> Result<String, String> {
    Err("Clipboard reading is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to write clipboard: {error}"))?;

    let Some(stdin) = child.stdin.as_mut() else {
        return Err("Unable to open clipboard input.".to_owned());
    };

    stdin
        .write_all(text.as_bytes())
        .map_err(|error| format!("Unable to write clipboard text: {error}"))?;

    let status = child
        .wait()
        .map_err(|error| format!("Unable to finish clipboard write: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Unable to write clipboard.".to_owned())
    }
}

#[cfg(not(target_os = "macos"))]
fn write_clipboard_text(_text: &str) -> Result<(), String> {
    Err("Clipboard writing is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn capture_screen() -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "I could not create a screenshot timestamp.".to_owned())?
        .as_secs();
    let capture_dir = std::env::temp_dir().join("friday-screen-captures");

    fs::create_dir_all(&capture_dir)
        .map_err(|error| format!("Unable to prepare screenshot folder: {error}"))?;

    let path = capture_dir.join(format!("friday-screen-{timestamp}.png"));
    let status = Command::new("screencapture")
        .arg("-x")
        .arg(&path)
        .status()
        .map_err(|error| format!("Unable to capture screen: {error}"))?;

    if status.success() {
        Ok(path)
    } else {
        Err("Screen capture failed. macOS may need Screen Recording permission for FRIDAY.".to_owned())
    }
}

#[cfg(not(target_os = "macos"))]
fn capture_screen() -> Result<PathBuf, String> {
    Err("Screen capture is currently implemented for macOS only.".to_owned())
}

fn normalize_url(target: &str) -> Result<String, String> {
    let trimmed_target = target.trim();

    if trimmed_target.is_empty() {
        return Err("Tell me which website to open.".to_owned());
    }

    if trimmed_target.len() > 2_000 {
        return Err("That URL is too long.".to_owned());
    }

    if trimmed_target.chars().any(char::is_whitespace) {
        return Err("Website URLs cannot contain spaces right now.".to_owned());
    }

    let candidate = if trimmed_target.starts_with("http://") || trimmed_target.starts_with("https://") {
        trimmed_target.to_owned()
    } else {
        format!("https://{trimmed_target}")
    };

    let Some(without_scheme) = candidate
        .strip_prefix("https://")
        .or_else(|| candidate.strip_prefix("http://")) else {
            return Err("Only http and https URLs are supported.".to_owned());
        };

    let host = without_scheme.split('/').next().unwrap_or_default();

    if !host.contains('.') {
        return Err("Tell me a full website domain, like example.com.".to_owned());
    }

    if !host
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '.'))
    {
        return Err("That website domain contains unsupported characters.".to_owned());
    }

    Ok(candidate)
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| format!("Unable to open {url}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("I could not open {url}."))
    }
}

#[cfg(not(target_os = "macos"))]
fn open_url(_url: &str) -> Result<(), String> {
    Err("Opening websites is currently implemented for macOS only.".to_owned())
}

#[cfg(target_os = "macos")]
fn candidate_piper_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.join("tools").join(LOCAL_PIPER_DIR_NAME));
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.join("tools").join(LOCAL_PIPER_DIR_NAME));
        }
    }

    roots
}

#[cfg(target_os = "macos")]
fn find_local_piper_binary() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FRIDAY_PIPER_BIN") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    candidate_piper_roots()
        .into_iter()
        .map(|root| root.join(".venv").join("bin").join("piper"))
        .find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn find_local_piper_model() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FRIDAY_PIPER_MODEL") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    candidate_piper_roots()
        .into_iter()
        .map(|root| root.join("models").join(LOCAL_PIPER_MODEL_NAME))
        .find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn local_piper_is_available() -> bool {
    find_local_piper_binary().is_some() && find_local_piper_model().is_some()
}

#[cfg(target_os = "macos")]
fn speak_with_piper(text: &str) -> Result<(), String> {
    let piper = find_local_piper_binary()
        .ok_or_else(|| "Local Piper voice engine is missing.".to_owned())?;
    let model = find_local_piper_model()
        .ok_or_else(|| "Local Piper voice model is missing.".to_owned())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("I could not prepare the voice timestamp: {error}"))?
        .as_millis();
    let work_dir = std::env::temp_dir().join("friday-voice");
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("I could not prepare the voice temp folder: {error}"))?;
    let output_path = work_dir.join(format!("friday-piper-{timestamp}.wav"));

    let mut piper_child = Command::new(piper)
        .arg("--model")
        .arg(model)
        .arg("--output_file")
        .arg(&output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("I could not start the neural voice: {error}"))?;

    if let Some(mut stdin) = piper_child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|error| format!("I could not send text to the neural voice: {error}"))?;
    }

    let piper_status = piper_child
        .wait()
        .map_err(|error| format!("The neural voice did not finish cleanly: {error}"))?;

    if !piper_status.success() {
        let _ = fs::remove_file(&output_path);
        return Err("The neural voice could not render that response.".to_owned());
    }

    let _ = Command::new("killall")
        .arg("afplay")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    Command::new("afplay")
        .arg(&output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("I could not play the neural voice: {error}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn speak_text(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    let voice_config = load_voice_config();

    if trimmed.is_empty() {
        return Err("Tell me what FRIDAY should say aloud.".to_owned());
    }

    if trimmed.chars().count() > 1_000 {
        return Err("That text is too long to speak in one response right now.".to_owned());
    }

    let spoken_text = prepare_say_text(trimmed);

    if local_piper_is_available() {
        let fallback_text = spoken_text.clone();
        let fallback_voice_config = voice_config.clone();

        std::thread::spawn(move || {
            if speak_with_piper(&spoken_text).is_err() {
                let _ = speak_with_macos_say(&fallback_text, &fallback_voice_config);
            }
        });

        return Ok("Speaking now.".to_owned());
    }

    speak_with_macos_say(&spoken_text, &voice_config)?;

    Ok("Speaking now.".to_owned())
}

#[cfg(target_os = "macos")]
fn speak_with_macos_say(text: &str, voice_config: &StoredVoiceConfig) -> Result<(), String> {
    let _ = Command::new("killall")
        .arg("say")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    Command::new("say")
        .arg("-v")
        .arg(&voice_config.voice)
        .arg("-r")
        .arg(voice_config.rate.to_string())
        .arg(text)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("I could not start the local voice: {error}"))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn speak_text(_text: &str) -> Result<String, String> {
    Err("Speaking aloud is currently implemented for macOS only.".to_owned())
}

async fn fetch_readable_webpage(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("FRIDAY/0.1 webpage reader")
        .build()
        .map_err(|error| format!("Unable to prepare webpage reader: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Unable to reach webpage: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("The webpage returned HTTP {status}."));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if !content_type.is_empty()
        && !content_type.contains("text/html")
        && !content_type.contains("text/plain")
        && !content_type.contains("application/xhtml")
    {
        return Err("That URL does not look like a readable webpage.".to_owned());
    }

    let body = response
        .text()
        .await
        .map_err(|error| format!("Unable to read webpage body: {error}"))?;
    let readable = if content_type.contains("text/plain") {
        compact_whitespace(&body)
    } else {
        extract_readable_html_text(&body)
    };

    if readable.trim().is_empty() {
        return Err("I could not extract readable text from that webpage.".to_owned());
    }

    Ok(truncate_chars(&readable, MAX_WEBPAGE_RESPONSE_CHARS))
}

async fn fetch_search_results(query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    let search_url = format!(
        "https://duckduckgo.com/html/?q={}",
        percent_encode_query(query),
    );
    let client = reqwest::Client::builder()
        .user_agent("FRIDAY/0.1 research agent")
        .build()
        .map_err(|error| format!("Unable to prepare research agent: {error}"))?;
    let response = client
        .get(&search_url)
        .send()
        .await
        .map_err(|error| format!("Unable to search the web: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("Search returned HTTP {status}."));
    }

    let html = response
        .text()
        .await
        .map_err(|error| format!("Unable to read search results: {error}"))?;

    Ok(extract_search_results(&html, limit))
}

fn extract_search_results(html: &str, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut cursor = 0;

    while results.len() < limit {
        let Some(relative_anchor_start) = html[cursor..].find("<a") else {
            break;
        };
        let anchor_start = cursor + relative_anchor_start;
        let Some(relative_open_end) = html[anchor_start..].find('>') else {
            break;
        };
        let open_end = anchor_start + relative_open_end;
        let opening = &html[anchor_start..=open_end];

        cursor = open_end + 1;

        if !opening.contains("result__a") {
            continue;
        }

        let Some(relative_close) = html[cursor..].find("</a>") else {
            break;
        };
        let close = cursor + relative_close;
        let raw_title = &html[cursor..close];
        let Some(raw_href) = extract_attribute(opening, "href") else {
            cursor = close + 4;
            continue;
        };

        let title = compact_whitespace(&extract_readable_html_text(raw_title));
        let url = clean_search_url(&raw_href);

        if !title.is_empty()
            && url.starts_with("http")
            && !results.iter().any(|result: &SearchResult| result.url == url)
        {
            results.push(SearchResult { title, url });
        }

        cursor = close + 4;
    }

    results
}

fn extract_attribute(tag: &str, attribute: &str) -> Option<String> {
    let needle = format!("{attribute}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;

    Some(tag[start..end].to_owned())
}

fn clean_search_url(raw_url: &str) -> String {
    let decoded = decode_basic_html_entities(raw_url);

    if let Some(uddg_start) = decoded.find("uddg=") {
        let value_start = uddg_start + "uddg=".len();
        let value_end = decoded[value_start..]
            .find('&')
            .map(|relative| value_start + relative)
            .unwrap_or(decoded.len());

        return percent_decode(&decoded[value_start..value_end]);
    }

    if decoded.starts_with("//") {
        return format!("https:{decoded}");
    }

    decoded
}

fn percent_encode_query(input: &str) -> String {
    input
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            b' ' => "+".to_owned(),
            _ => format!("%{byte:02X}"),
        })
        .collect::<String>()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(value) = u8::from_str_radix(hex, 16) {
                    output.push(value);
                    index += 3;
                    continue;
                }
            }
        }

        output.push(if bytes[index] == b'+' { b' ' } else { bytes[index] });
        index += 1;
    }

    String::from_utf8_lossy(&output).to_string()
}

fn extract_readable_html_text(html: &str) -> String {
    let without_scripts = strip_html_blocks(html, "script");
    let without_styles = strip_html_blocks(&without_scripts, "style");
    let mut text = String::with_capacity(without_styles.len());
    let mut inside_tag = false;

    for character in without_styles.chars() {
        match character {
            '<' => {
                inside_tag = true;
                text.push(' ');
            }
            '>' => {
                inside_tag = false;
                text.push(' ');
            }
            _ if !inside_tag => text.push(character),
            _ => {}
        }
    }

    compact_whitespace(&decode_basic_html_entities(&text))
}

fn strip_html_blocks(input: &str, tag_name: &str) -> String {
    let mut remaining = input.to_owned();
    let open = format!("<{tag_name}");
    let close = format!("</{tag_name}>");

    loop {
        let lower = remaining.to_lowercase();
        let Some(start) = lower.find(&open) else {
            return remaining;
        };
        let Some(relative_end) = lower[start..].find(&close) else {
            remaining.replace_range(start.., "");
            return remaining;
        };
        let end = start + relative_end + close.len();
        remaining.replace_range(start..end, " ");
    }
}

fn decode_basic_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn compact_whitespace(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate_chars(input: &str, limit: usize) -> String {
    if input.chars().count() <= limit {
        return input.to_owned();
    }

    format!(
        "{}\n\n...truncated after {limit} characters.",
        input.chars().take(limit).collect::<String>(),
    )
}

fn provider_from_name(provider: &str) -> Result<AIProviderKind, String> {
    match provider.trim().to_lowercase().as_str() {
        "gemini" => Ok(AIProviderKind::Gemini),
        "openai" => Ok(AIProviderKind::OpenAI),
        "openrouter" => Ok(AIProviderKind::OpenRouter),
        "groq" => Ok(AIProviderKind::Groq),
        _ => Err("Choose Groq, Gemini, OpenAI, or OpenRouter as the provider.".to_owned()),
    }
}

fn stt_provider_from_name(provider: &str) -> Result<STTProviderKind, String> {
    match provider.trim().to_lowercase().as_str() {
        "openai" => Ok(STTProviderKind::OpenAI),
        "gemini" => Ok(STTProviderKind::Gemini),
        _ => Err("Choose OpenAI or Gemini as the voice input provider.".to_owned()),
    }
}

impl STTProviderKind {
    fn provider_name(self) -> &'static str {
        match self {
            STTProviderKind::OpenAI => "openai",
            STTProviderKind::Gemini => "gemini",
        }
    }
}

impl STTProviderConfig {
    fn provider_name(&self) -> &'static str {
        self.provider.provider_name()
    }
}

fn default_model_for_provider(provider: AIProviderKind) -> String {
    match provider {
        AIProviderKind::Gemini => "gemini-2.0-flash".to_owned(),
        AIProviderKind::OpenAI => "gpt-4.1-mini".to_owned(),
        AIProviderKind::OpenRouter => "openai/gpt-4.1-mini".to_owned(),
        AIProviderKind::Groq => "llama-3.1-8b-instant".to_owned(),
    }
}

fn default_stt_model_for_provider(provider: STTProviderKind) -> String {
    match provider {
        STTProviderKind::OpenAI => DEFAULT_OPENAI_STT_MODEL.to_owned(),
        STTProviderKind::Gemini => default_model_for_provider(AIProviderKind::Gemini),
    }
}

fn normalize_model_for_provider(provider: AIProviderKind, model: String) -> String {
    let trimmed = model.trim();

    if trimmed.is_empty() || trimmed == "gemini-3.5-flash" || trimmed == "gpt-5.2" {
        return default_model_for_provider(provider);
    }

    trimmed.to_owned()
}

fn normalize_stt_model_for_provider(provider: STTProviderKind, model: String) -> String {
    let trimmed = model.trim();

    if trimmed.is_empty() {
        return default_stt_model_for_provider(provider);
    }

    trimmed.to_owned()
}

fn friday_config_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "I could not find the local home folder for FRIDAY config.".to_owned())?;

    #[cfg(target_os = "macos")]
    {
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(FRIDAY_CONFIG_DIR_NAME));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(PathBuf::from(home).join(".config").join(FRIDAY_CONFIG_DIR_NAME))
    }
}

fn ai_config_path() -> Result<PathBuf, String> {
    Ok(friday_config_dir()?.join(AI_CONFIG_FILE_NAME))
}

fn stt_config_path() -> Result<PathBuf, String> {
    Ok(friday_config_dir()?.join(STT_CONFIG_FILE_NAME))
}

fn voice_config_path() -> Result<PathBuf, String> {
    Ok(friday_config_dir()?.join(VOICE_CONFIG_FILE_NAME))
}

fn default_voice_config() -> StoredVoiceConfig {
    StoredVoiceConfig {
        voice: "Reed (English (US))".to_owned(),
        rate: 162,
    }
}

fn normalize_voice_name(voice: &str) -> String {
    let normalized = voice.trim().to_lowercase();

    match normalized.as_str() {
        "default" | "natural" | "premium" | "calm" | "friday" | "jarvis" => "Reed (English (US))".to_owned(),
        "female" | "soft" | "warm" => "Sandy (English (US))".to_owned(),
        "male" | "american" | "us" | "reed" => "Reed (English (US))".to_owned(),
        "british" | "uk" | "daniel" => "Daniel".to_owned(),
        "indian" | "india" | "rishi" => "Rishi".to_owned(),
        "samantha" => "Samantha".to_owned(),
        "sandy" => "Sandy (English (US))".to_owned(),
        "shelley" => "Shelley (English (US))".to_owned(),
        "flo" => "Flo (English (US))".to_owned(),
        "eddy" => "Eddy (English (US))".to_owned(),
        "australian" | "karen" => "Karen".to_owned(),
        _ => voice.trim().to_owned(),
    }
}

#[cfg(target_os = "macos")]
fn prepare_say_text(text: &str) -> String {
    let normalized = text
        .replace("FRIDAY", "Friday")
        .replace("AI", "A I")
        .replace("API", "A P I")
        .replace("URL", "U R L")
        .replace("...", ".")
        .replace("—", ", ")
        .replace("–", ", ");

    normalized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn load_voice_config() -> StoredVoiceConfig {
    let Some(stored) = voice_config_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str::<StoredVoiceConfig>(&contents).ok()) else {
            return default_voice_config();
        };

    let voice = stored.voice.trim();

    if voice.is_empty() {
        return default_voice_config();
    }

    StoredVoiceConfig {
        voice: normalize_voice_name(voice),
        rate: stored.rate.clamp(90, 230),
    }
}

fn save_voice_config(request: SaveVoiceConfigRequest) -> Result<StoredVoiceConfig, String> {
    let voice = request.voice.trim();

    if voice.is_empty() {
        return Err("Tell me which voice FRIDAY should use.".to_owned());
    }

    if voice.chars().count() > 64
        || !voice
            .chars()
            .all(|character| character.is_ascii_alphabetic() || matches!(character, ' ' | '-' | '_' | '(' | ')'))
    {
        return Err("That voice name looks invalid. Use a macOS voice name like Reed, Sandy, Shelley, Daniel, or Rishi.".to_owned());
    }

    let config = StoredVoiceConfig {
        voice: normalize_voice_name(voice),
        rate: request.rate.unwrap_or(145).clamp(90, 230),
    };
    let config_dir = friday_config_dir()?;
    let config_path = config_dir.join(VOICE_CONFIG_FILE_NAME);
    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("I could not create the FRIDAY config folder: {error}"))?;
    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("I could not prepare the voice config: {error}"))?;
    fs::write(config_path, serialized)
        .map_err(|error| format!("I could not save the voice config: {error}"))?;

    Ok(config)
}

fn load_stored_ai_config() -> Option<AIProviderConfig> {
    let path = ai_config_path().ok()?;
    let contents = fs::read_to_string(path).ok()?;
    let stored = serde_json::from_str::<StoredAIProviderConfig>(&contents).ok()?;
    let provider = provider_from_name(&stored.provider).ok()?;
    let api_key = stored.api_key.trim().to_owned();

    if api_key.is_empty() {
        return None;
    }

    let model = normalize_model_for_provider(provider, stored
        .model
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_model_for_provider(provider)));

    Some(AIProviderConfig {
        provider,
        api_key,
        model,
    })
}

fn save_stored_ai_config(request: SaveAIProviderConfigRequest) -> Result<AIProviderConfig, String> {
    let provider = provider_from_name(&request.provider)?;
    let api_key = request.api_key.trim().to_owned();

    if api_key.len() < 16 {
        return Err("That API key looks too short.".to_owned());
    }

    let model = normalize_model_for_provider(provider, request
        .model
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_model_for_provider(provider)));
    let stored = StoredAIProviderConfig {
        provider: provider.provider_name().to_owned(),
        api_key: api_key.clone(),
        model: Some(model.clone()),
    };
    let config_dir = friday_config_dir()?;
    let config_path = config_dir.join(AI_CONFIG_FILE_NAME);
    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("I could not create the FRIDAY config folder: {error}"))?;
    let serialized = serde_json::to_string_pretty(&stored)
        .map_err(|error| format!("I could not prepare the provider config: {error}"))?;
    fs::write(config_path, serialized)
        .map_err(|error| format!("I could not save the provider config: {error}"))?;

    Ok(AIProviderConfig {
        provider,
        api_key,
        model,
    })
}

fn load_stored_stt_config() -> Option<STTProviderConfig> {
    let path = stt_config_path().ok()?;
    let contents = fs::read_to_string(path).ok()?;
    let stored = serde_json::from_str::<StoredSTTProviderConfig>(&contents).ok()?;
    let provider = stt_provider_from_name(&stored.provider).ok()?;
    let api_key = stored.api_key.trim().to_owned();

    if api_key.is_empty() {
        return None;
    }

    let model = normalize_stt_model_for_provider(provider, stored
        .model
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_stt_model_for_provider(provider)));

    Some(STTProviderConfig {
        provider,
        api_key,
        model,
    })
}

fn save_stored_stt_config(request: SaveSTTProviderConfigRequest) -> Result<STTProviderConfig, String> {
    let provider = stt_provider_from_name(&request.provider)?;
    let api_key = request.api_key.trim().to_owned();

    if api_key.len() < 16 {
        return Err("That speech-to-text API key looks too short.".to_owned());
    }

    let model = normalize_stt_model_for_provider(provider, request
        .model
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_stt_model_for_provider(provider)));
    let stored = StoredSTTProviderConfig {
        provider: provider.provider_name().to_owned(),
        api_key: api_key.clone(),
        model: Some(model.clone()),
    };
    let config_dir = friday_config_dir()?;
    let config_path = config_dir.join(STT_CONFIG_FILE_NAME);
    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("I could not create the FRIDAY config folder: {error}"))?;
    let serialized = serde_json::to_string_pretty(&stored)
        .map_err(|error| format!("I could not prepare the voice input config: {error}"))?;
    fs::write(config_path, serialized)
        .map_err(|error| format!("I could not save the voice input config: {error}"))?;

    Ok(STTProviderConfig {
        provider,
        api_key,
        model,
    })
}

fn detect_stt_provider_config() -> Option<STTProviderConfig> {
    if let Ok(api_key) = std::env::var("OPENAI_STT_API_KEY")
        .or_else(|_| std::env::var("OPENAI_API_KEY")) {
        return Some(STTProviderConfig {
            provider: STTProviderKind::OpenAI,
            api_key,
            model: normalize_stt_model_for_provider(
                STTProviderKind::OpenAI,
                std::env::var("OPENAI_STT_MODEL")
                    .unwrap_or_else(|_| DEFAULT_OPENAI_STT_MODEL.to_owned()),
            ),
        });
    }

    if let Some(config) = load_stored_stt_config() {
        return Some(config);
    }

    detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::Gemini))
        .map(|config| STTProviderConfig {
            provider: STTProviderKind::Gemini,
            api_key: config.api_key,
            model: config.model,
        })
}

fn detect_provider_config() -> Option<AIProviderConfig> {
    if let Ok(api_key) = std::env::var("GEMINI_API_KEY") {
        return Some(AIProviderConfig {
            provider: AIProviderKind::Gemini,
            api_key,
            model: normalize_model_for_provider(
                AIProviderKind::Gemini,
                std::env::var("GEMINI_MODEL")
                    .unwrap_or_else(|_| default_model_for_provider(AIProviderKind::Gemini)),
            ),
        });
    }

    if let Ok(api_key) = std::env::var("OPENAI_API_KEY") {
        return Some(AIProviderConfig {
            provider: AIProviderKind::OpenAI,
            api_key,
            model: normalize_model_for_provider(
                AIProviderKind::OpenAI,
                std::env::var("OPENAI_MODEL")
                    .unwrap_or_else(|_| default_model_for_provider(AIProviderKind::OpenAI)),
            ),
        });
    }

    if let Ok(api_key) = std::env::var("OPENROUTER_API_KEY") {
        return Some(AIProviderConfig {
            provider: AIProviderKind::OpenRouter,
            api_key,
            model: normalize_model_for_provider(
                AIProviderKind::OpenRouter,
                std::env::var("OPENROUTER_MODEL")
                    .unwrap_or_else(|_| default_model_for_provider(AIProviderKind::OpenRouter)),
            ),
        });
    }

    if let Ok(api_key) = std::env::var("GROQ_API_KEY") {
        return Some(AIProviderConfig {
            provider: AIProviderKind::Groq,
            api_key,
            model: normalize_model_for_provider(
                AIProviderKind::Groq,
                std::env::var("GROQ_MODEL")
                    .unwrap_or_else(|_| default_model_for_provider(AIProviderKind::Groq)),
            ),
        });
    }

    load_stored_ai_config()
}

async fn generate_openai_response(request: AIGenerateRequest) -> Result<AIGenerateResponse, String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::OpenAI))
        .ok_or_else(|| "OpenAI is not configured for FRIDAY.".to_owned())?;

    let client = ai_http_client()?;
    let response = client
        .post(OPENAI_RESPONSES_URL)
        .bearer_auth(&config.api_key)
        .json(&json!({
            "model": &config.model,
            "input": build_openai_input(&request),
            "max_output_tokens": MAX_AI_OUTPUT_TOKENS,
            "temperature": CONVERSATION_TEMPERATURE,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach OpenAI: {error}"))?;

    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("OpenAI returned an unreadable response: {error}"))?;

    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("OpenAI request failed.");

        return Err(message.to_owned());
    }

    let text = extract_response_text(&body)
        .ok_or_else(|| "OpenAI response did not contain readable text.".to_owned())?;

    Ok(AIGenerateResponse {
        text,
        provider: "openai".to_owned(),
        model: config.model,
    })
}

async fn stream_openai_response(
    window: &Window,
    request_id: &str,
    request: AIGenerateRequest,
) -> Result<(), String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::OpenAI))
        .ok_or_else(|| "OpenAI is not configured for FRIDAY.".to_owned())?;
    emit_stream_metadata(window, request_id, "openai", &config.model)?;

    let client = ai_http_client()?;
    let response = client
        .post(OPENAI_RESPONSES_URL)
        .bearer_auth(&config.api_key)
        .json(&json!({
            "model": &config.model,
            "input": build_openai_input(&request),
            "stream": true,
            "max_output_tokens": MAX_AI_OUTPUT_TOKENS,
            "temperature": CONVERSATION_TEMPERATURE,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach OpenAI: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response
            .json::<Value>()
            .await
            .map_err(|error| format!("OpenAI returned an unreadable response: {error}"))?;
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("OpenAI request failed.");

        return Err(message.to_owned());
    }

    consume_sse_stream(window, request_id, response, extract_openai_delta).await
}

async fn generate_openrouter_response(request: AIGenerateRequest) -> Result<AIGenerateResponse, String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::OpenRouter))
        .ok_or_else(|| "OpenRouter is not configured for FRIDAY.".to_owned())?;

    let client = ai_http_client()?;
    let response = client
        .post(OPENROUTER_CHAT_COMPLETIONS_URL)
        .bearer_auth(&config.api_key)
        .header("HTTP-Referer", "https://friday.local")
        .header("X-OpenRouter-Title", "FRIDAY")
        .json(&json!({
            "model": &config.model,
            "messages": build_chat_messages(&request),
            "max_tokens": MAX_AI_OUTPUT_TOKENS,
            "temperature": CONVERSATION_TEMPERATURE,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach OpenRouter: {error}"))?;

    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("OpenRouter returned an unreadable response: {error}"))?;

    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("OpenRouter request failed.");

        return Err(message.to_owned());
    }

    let text = body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "OpenRouter response did not contain readable text.".to_owned())?;

    Ok(AIGenerateResponse {
        text,
        provider: "openrouter".to_owned(),
        model: config.model,
    })
}

async fn stream_openrouter_response(
    window: &Window,
    request_id: &str,
    request: AIGenerateRequest,
) -> Result<(), String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::OpenRouter))
        .ok_or_else(|| "OpenRouter is not configured for FRIDAY.".to_owned())?;
    emit_stream_metadata(window, request_id, "openrouter", &config.model)?;

    let client = ai_http_client()?;
    let response = client
        .post(OPENROUTER_CHAT_COMPLETIONS_URL)
        .bearer_auth(&config.api_key)
        .header("HTTP-Referer", "https://friday.local")
        .header("X-OpenRouter-Title", "FRIDAY")
        .json(&json!({
            "model": &config.model,
            "messages": build_chat_messages(&request),
            "stream": true,
            "max_tokens": MAX_AI_OUTPUT_TOKENS,
            "temperature": CONVERSATION_TEMPERATURE,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach OpenRouter: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response
            .json::<Value>()
            .await
            .map_err(|error| format!("OpenRouter returned an unreadable response: {error}"))?;
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("OpenRouter request failed.");

        return Err(message.to_owned());
    }

    consume_sse_stream(window, request_id, response, extract_openrouter_delta).await
}

async fn generate_groq_response(request: AIGenerateRequest) -> Result<AIGenerateResponse, String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::Groq))
        .ok_or_else(|| "Groq is not configured for FRIDAY.".to_owned())?;

    let client = ai_http_client()?;
    let response = client
        .post(GROQ_CHAT_COMPLETIONS_URL)
        .bearer_auth(&config.api_key)
        .json(&json!({
            "model": &config.model,
            "messages": build_chat_messages(&request),
            "max_tokens": MAX_AI_OUTPUT_TOKENS,
            "temperature": CONVERSATION_TEMPERATURE,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach Groq: {error}"))?;

    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Groq returned an unreadable response: {error}"))?;

    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Groq request failed.");

        return Err(message.to_owned());
    }

    let text = body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Groq response did not contain readable text.".to_owned())?;

    Ok(AIGenerateResponse {
        text,
        provider: "groq".to_owned(),
        model: config.model,
    })
}

async fn stream_groq_response(
    window: &Window,
    request_id: &str,
    request: AIGenerateRequest,
) -> Result<(), String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::Groq))
        .ok_or_else(|| "Groq is not configured for FRIDAY.".to_owned())?;
    emit_stream_metadata(window, request_id, "groq", &config.model)?;

    let client = ai_http_client()?;
    let response = client
        .post(GROQ_CHAT_COMPLETIONS_URL)
        .bearer_auth(&config.api_key)
        .json(&json!({
            "model": &config.model,
            "messages": build_chat_messages(&request),
            "stream": true,
            "max_tokens": MAX_AI_OUTPUT_TOKENS,
            "temperature": CONVERSATION_TEMPERATURE,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach Groq: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response
            .json::<Value>()
            .await
            .map_err(|error| format!("Groq returned an unreadable response: {error}"))?;
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Groq request failed.");

        return Err(message.to_owned());
    }

    consume_sse_stream(window, request_id, response, extract_openrouter_delta).await
}

fn build_gemini_input(request: &AIGenerateRequest) -> String {
    request
        .messages
        .iter()
        .filter(|message| !message.content.trim().is_empty())
        .map(|message| {
            let speaker = match message.role.as_str() {
                "assistant" => "FRIDAY",
                _ => "User",
            };

            format!("{speaker}: {}", message.content)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn gemini_generate_url(model: &str) -> String {
    format!("{GEMINI_MODELS_URL}/{model}:generateContent")
}

fn gemini_stream_url(model: &str) -> String {
    format!("{GEMINI_MODELS_URL}/{model}:streamGenerateContent?alt=sse")
}

fn build_gemini_request_body(request: &AIGenerateRequest) -> Value {
    json!({
        "systemInstruction": {
            "parts": [{ "text": &request.system_prompt }],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{ "text": build_gemini_input(request) }],
            },
        ],
        "generationConfig": {
            "maxOutputTokens": MAX_AI_OUTPUT_TOKENS,
            "temperature": CONVERSATION_TEMPERATURE,
        },
    })
}

fn extract_gemini_candidate_text(value: &Value) -> Option<String> {
    value
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn audio_file_extension(mime_type: &str) -> &'static str {
    match mime_type.split(';').next().unwrap_or("").trim() {
        "audio/mp4" | "audio/m4a" => "m4a",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        _ => "webm",
    }
}

async fn transcribe_audio(request: AITranscribeAudioRequest) -> Result<String, String> {
    if local_whisper_is_available() {
        return transcribe_local_whisper_audio(request);
    }

    let config = detect_stt_provider_config().ok_or_else(|| {
        "Local Whisper is not installed yet. Run the FRIDAY Whisper setup once, or save a speech-to-text key with: save openai stt key YOUR_KEY".to_owned()
    })?;

    match config.provider {
        STTProviderKind::OpenAI => transcribe_openai_audio(request, config).await,
        STTProviderKind::Gemini => transcribe_gemini_audio(request, config).await,
    }
}

fn candidate_whisper_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir.join("tools").join(LOCAL_WHISPER_DIR_NAME));
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.join("tools").join(LOCAL_WHISPER_DIR_NAME));
        }
    }

    roots
}

fn find_local_whisper_cli() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FRIDAY_WHISPER_CLI") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    candidate_whisper_roots()
        .into_iter()
        .map(|root| root.join("build").join("bin").join("whisper-cli"))
        .find(|path| path.exists())
}

fn find_local_whisper_model() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FRIDAY_WHISPER_MODEL") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    candidate_whisper_roots()
        .into_iter()
        .flat_map(|root| {
            LOCAL_WHISPER_MODEL_NAMES
                .iter()
                .map(move |model_name| root.join("models").join(model_name))
        })
        .find(|path| path.exists())
}

fn find_local_whisper_vad_model() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FRIDAY_WHISPER_VAD_MODEL") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }

    candidate_whisper_roots()
        .into_iter()
        .map(|root| root.join("models").join(LOCAL_WHISPER_VAD_MODEL_NAME))
        .find(|path| path.exists())
}

fn local_whisper_is_available() -> bool {
    find_local_whisper_cli().is_some() && find_local_whisper_model().is_some()
}

fn decode_audio_bytes(request: &AITranscribeAudioRequest) -> Result<Vec<u8>, String> {
    let audio_data = request.data_base64.trim();

    if audio_data.is_empty() {
        return Err("I did not receive any audio to transcribe.".to_owned());
    }

    if audio_data.len() > 2_500_000 {
        return Err("That voice clip is too long for quick transcription.".to_owned());
    }

    general_purpose::STANDARD
        .decode(audio_data)
        .map_err(|_| "I could not decode the microphone audio.".to_owned())
}

fn is_low_confidence_whisper_transcript(transcript: &str) -> bool {
    let normalized = compact_whitespace(transcript)
        .trim_matches(|character: char| !character.is_ascii_alphanumeric())
        .to_lowercase();

    if normalized.is_empty() {
        return true;
    }

    let word_count = normalized.split_whitespace().count();
    let common_hallucinations = [
        "audio",
        "all",
        "you",
        "thank you",
        "thanks for watching",
        "thank you for watching",
        "bye",
        "goodbye",
        "music",
        "silence",
        "still not hearing anything",
        "if you want you can describe what you wanted to share or ask instead",
    ];

    (word_count <= 2 && common_hallucinations.contains(&normalized.as_str()))
        || common_hallucinations.iter().any(|phrase| normalized.contains(phrase))
        || normalized.contains("not hearing anything")
        || normalized.contains("describe what you wanted to share")
        || normalized.contains("what you wanted to share or ask")
        || normalized.starts_with("[")
        || normalized.starts_with("(")
}

fn transcribe_local_whisper_audio(request: AITranscribeAudioRequest) -> Result<String, String> {
    let whisper_cli = find_local_whisper_cli()
        .ok_or_else(|| "Local Whisper is missing the whisper-cli binary.".to_owned())?;
    let whisper_model = find_local_whisper_model()
        .ok_or_else(|| "Local Whisper is missing the speech model.".to_owned())?;
    let audio_bytes = decode_audio_bytes(&request)?;
    let extension = audio_file_extension(&request.mime_type);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("I could not prepare the voice clip timestamp: {error}"))?
        .as_millis();
    let work_dir = std::env::temp_dir().join("friday-voice");
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("I could not prepare the voice temp folder: {error}"))?;
    let input_path = work_dir.join(format!("voice-{timestamp}.{extension}"));
    let wav_path = work_dir.join(format!("voice-{timestamp}.wav"));

    fs::write(&input_path, audio_bytes)
        .map_err(|error| format!("I could not save the microphone audio: {error}"))?;

    let conversion_status = Command::new("afconvert")
        .arg("-f")
        .arg("WAVE")
        .arg("-d")
        .arg("LEI16@16000")
        .arg("-c")
        .arg("1")
        .arg(&input_path)
        .arg(&wav_path)
        .status()
        .map_err(|error| format!("I could not convert microphone audio for Whisper: {error}"))?;

    if !conversion_status.success() {
        let _ = fs::remove_file(&input_path);
        return Err("I could not convert the microphone audio into Whisper's format.".to_owned());
    }

    let mut whisper_command = Command::new(&whisper_cli);
    whisper_command
        .arg("-m")
        .arg(&whisper_model)
        .arg("-f")
        .arg(&wav_path)
        .arg("-nt")
        .arg("-np")
        .arg("-l")
        .arg("en")
        .arg("-sns")
        .arg("-nf")
        .arg("-nth")
        .arg("0.72")
        .arg("-et")
        .arg("2.00");

    if let Some(vad_model) = find_local_whisper_vad_model() {
        whisper_command
            .arg("--vad")
            .arg("-vm")
            .arg(vad_model)
            .arg("-vt")
            .arg("0.58")
            .arg("-vspd")
            .arg("300")
            .arg("-vsd")
            .arg("450")
            .arg("-vp")
            .arg("80");
    }

    let output = whisper_command
        .output()
        .map_err(|error| format!("I could not run local Whisper: {error}"))?;

    let _ = fs::remove_file(&input_path);
    let _ = fs::remove_file(&wav_path);

    if !output.status.success() {
        let error_text = compact_whitespace(&String::from_utf8_lossy(&output.stderr));
        return Err(if error_text.is_empty() {
            "Local Whisper could not transcribe that voice clip.".to_owned()
        } else {
            format!("Local Whisper could not transcribe that voice clip: {error_text}")
        });
    }

    let transcript = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            !line.starts_with("whisper_")
                && !line.starts_with("system_info:")
                && !line.starts_with("read_audio_data:")
        })
        .collect::<Vec<_>>()
        .join(" ");

    let transcript = compact_whitespace(&transcript);

    if is_low_confidence_whisper_transcript(&transcript) {
        return Ok(String::new());
    }

    Ok(transcript)
}

async fn transcribe_openai_audio(
    request: AITranscribeAudioRequest,
    config: STTProviderConfig,
) -> Result<String, String> {
    let audio_data = request.data_base64.trim();
    let mime_type = request.mime_type.trim();

    if audio_data.is_empty() {
        return Err("I did not receive any audio to transcribe.".to_owned());
    }

    if audio_data.len() > 2_500_000 {
        return Err("That voice clip is too long for quick transcription.".to_owned());
    }

    let audio_bytes = general_purpose::STANDARD
        .decode(audio_data)
        .map_err(|_| "I could not decode the microphone audio.".to_owned())?;
    let extension = audio_file_extension(mime_type);
    let audio_part = multipart::Part::bytes(audio_bytes)
        .file_name(format!("friday-voice.{extension}"))
        .mime_str(mime_type)
        .map_err(|error| format!("I could not prepare microphone audio: {error}"))?;
    let form = multipart::Form::new()
        .text("model", config.model)
        .text("response_format", "json")
        .part("file", audio_part);

    let client = ai_http_client()?;
    let response = client
        .post(OPENAI_TRANSCRIPTIONS_URL)
        .bearer_auth(&config.api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Unable to reach OpenAI for voice transcription: {error}"))?;

    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("OpenAI returned an unreadable voice response: {error}"))?;

    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("OpenAI voice transcription failed.");

        return Err(message.to_owned());
    }

    Ok(body
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned())
}

async fn transcribe_gemini_audio(
    request: AITranscribeAudioRequest,
    config: STTProviderConfig,
) -> Result<String, String> {
    let audio_data = request.data_base64.trim();
    let mime_type = request.mime_type.trim();

    if audio_data.is_empty() {
        return Err("I did not receive any audio to transcribe.".to_owned());
    }

    if audio_data.len() > 2_500_000 {
        return Err("That voice clip is too long for quick transcription.".to_owned());
    }

    let client = ai_http_client()?;
    let response = client
        .post(gemini_generate_url(&config.model))
        .header("x-goog-api-key", &config.api_key)
        .json(&json!({
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": "Transcribe this short voice command. Return only the exact spoken words. If there is no clear speech, return an empty string.",
                        },
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": audio_data,
                            },
                        },
                    ],
                },
            ],
            "generationConfig": {
                "maxOutputTokens": 80,
                "temperature": 0.0,
            },
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach Gemini for voice transcription: {error}"))?;

    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Gemini returned an unreadable voice response: {error}"))?;

    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Gemini voice transcription failed.");

        return Err(message.to_owned());
    }

    let transcript = extract_gemini_candidate_text(&body)
        .unwrap_or_default()
        .trim()
        .trim_matches('"')
        .trim()
        .to_owned();

    Ok(transcript)
}

async fn generate_gemini_response(request: AIGenerateRequest) -> Result<AIGenerateResponse, String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::Gemini))
        .ok_or_else(|| "Gemini is not configured for FRIDAY.".to_owned())?;
    let client = ai_http_client()?;
    let response = client
        .post(gemini_generate_url(&config.model))
        .header("x-goog-api-key", &config.api_key)
        .json(&build_gemini_request_body(&request))
        .send()
        .await
        .map_err(|error| format!("Unable to reach Gemini: {error}"))?;

    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Gemini returned an unreadable response: {error}"))?;

    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Gemini request failed.");

        return Err(message.to_owned());
    }

    let text = extract_gemini_candidate_text(&body)
        .or_else(|| extract_gemini_text_from_steps(&body))
        .ok_or_else(|| "Gemini response did not contain readable text.".to_owned())?;

    Ok(AIGenerateResponse {
        text,
        provider: "gemini".to_owned(),
        model: config.model,
    })
}

async fn stream_gemini_response(
    window: &Window,
    request_id: &str,
    request: AIGenerateRequest,
) -> Result<(), String> {
    let config = detect_provider_config()
        .filter(|config| matches!(config.provider, AIProviderKind::Gemini))
        .ok_or_else(|| "Gemini is not configured for FRIDAY.".to_owned())?;
    emit_stream_metadata(window, request_id, "gemini", &config.model)?;

    let client = ai_http_client()?;
    let response = client
        .post(gemini_stream_url(&config.model))
        .header("x-goog-api-key", &config.api_key)
        .json(&build_gemini_request_body(&request))
        .send()
        .await
        .map_err(|error| format!("Unable to reach Gemini: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response
            .json::<Value>()
            .await
            .map_err(|error| format!("Gemini returned an unreadable response: {error}"))?;
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Gemini request failed.");

        return Err(message.to_owned());
    }

    consume_sse_stream(window, request_id, response, extract_gemini_delta).await
}

fn extract_gemini_text_from_steps(value: &Value) -> Option<String> {
    let steps = value.get("steps")?.as_array()?;
    let mut text = String::new();

    for step in steps {
        let Some(content) = step.get("content").and_then(Value::as_array) else {
            continue;
        };

        for part in content {
            if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                text.push_str(part_text);
            }
        }
    }

    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

async fn consume_sse_stream(
    window: &Window,
    request_id: &str,
    response: reqwest::Response,
    extract_delta: fn(&Value) -> Option<String>,
) -> Result<(), String> {
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("AI stream interrupted: {error}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(boundary) = buffer.find("\n\n") {
            let event = buffer[..boundary].to_owned();
            buffer = buffer[boundary + 2..].to_owned();
            handle_sse_event(window, request_id, &event, extract_delta)?;
        }
    }

    if !buffer.trim().is_empty() {
        handle_sse_event(window, request_id, &buffer, extract_delta)?;
    }

    Ok(())
}

fn handle_sse_event(
    window: &Window,
    request_id: &str,
    event: &str,
    extract_delta: fn(&Value) -> Option<String>,
) -> Result<(), String> {
    for line in event.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };

        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }

        let value = serde_json::from_str::<Value>(data)
            .map_err(|error| format!("Unable to parse AI stream event: {error}"))?;

        if let Some(delta) = extract_delta(&value) {
            emit_stream_event(window, request_id, "delta", Some(delta), None)?;
        }
    }

    Ok(())
}

fn extract_openai_delta(value: &Value) -> Option<String> {
    let event_type = value.get("type").and_then(Value::as_str);

    if event_type == Some("response.output_text.delta") {
        return value.get("delta").and_then(Value::as_str).map(str::to_owned);
    }

    if event_type == Some("response.output_text.done") {
        return None;
    }

    value
        .get("delta")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn extract_openrouter_delta(value: &Value) -> Option<String> {
    value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/choices/0/message/content").and_then(Value::as_str))
        .map(str::to_owned)
}

fn extract_gemini_delta(value: &Value) -> Option<String> {
    value
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/delta/text").and_then(Value::as_str))
        .or_else(|| value.get("output_text").and_then(Value::as_str))
        .map(str::to_owned)
}

fn emit_stream_event(
    window: &Window,
    request_id: &str,
    event_type: &str,
    content: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    window
        .emit(
            AI_STREAM_EVENT,
            AIStreamEvent {
                request_id: request_id.to_owned(),
                event_type: event_type.to_owned(),
                content,
                error,
                provider: None,
                model: None,
            },
        )
        .map_err(|error| format!("Unable to emit AI stream event: {error}"))
}

fn emit_stream_metadata(
    window: &Window,
    request_id: &str,
    provider: &str,
    model: &str,
) -> Result<(), String> {
    window
        .emit(
            AI_STREAM_EVENT,
            AIStreamEvent {
                request_id: request_id.to_owned(),
                event_type: "metadata".to_owned(),
                content: None,
                error: None,
                provider: Some(provider.to_owned()),
                model: Some(model.to_owned()),
            },
        )
        .map_err(|error| format!("Unable to emit AI stream metadata: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ai_generate_response,
            ai_provider_status,
            ai_save_provider_config,
            ai_stt_provider_status,
            ai_save_stt_provider_config,
            ai_stream_response,
            ai_transcribe_audio,
            desktop_open_application,
            desktop_quit_application,
            desktop_focus_application,
            desktop_list_applications,
            desktop_system_status,
            desktop_list_processes,
            desktop_network_status,
            desktop_storage_status,
            desktop_active_window,
            desktop_list_windows,
            desktop_send_notification,
            desktop_list_directory,
            desktop_tree_directory,
            desktop_folder_summary,
            desktop_path_info,
            desktop_create_folder,
            desktop_create_text_file,
            desktop_append_text_file,
            desktop_rename_path,
            desktop_move_path,
            desktop_copy_path,
            desktop_trash_path,
            desktop_reveal_path,
            desktop_open_path,
            desktop_search_files,
            desktop_search_text,
            desktop_read_text_file,
            desktop_read_clipboard,
            desktop_write_clipboard,
            desktop_capture_screen,
            desktop_speak_text,
            voice_save_config,
            desktop_open_url,
            desktop_read_url,
            desktop_research_web,
            desktop_deep_research_web,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
