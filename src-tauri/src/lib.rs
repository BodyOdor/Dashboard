use serde::{Serialize, Deserialize};
use sysinfo::System;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::process::Child;

#[derive(Serialize)]
pub struct SystemStats {
    cpu: f32,
    memory_used: u64,
    memory_total: u64,
    memory_percent: f32,
    disk_used: u64,
    disk_total: u64,
    disk_percent: f32,
}

#[derive(Serialize, Clone)]
pub struct Task {
    text: String,
    done: bool,
}

#[derive(Serialize)]
pub struct Project {
    id: String,
    name: String,
    status: String,
    category: String,
    description: String,
    task_count: usize,
    tasks_done: usize,
    tasks: Vec<Task>,
}

#[tauri::command]
fn get_system_stats() -> SystemStats {
    let mut sys = System::new_all();
    sys.refresh_all();
    
    // CPU usage (average across all cores)
    let cpu = sys.global_cpu_usage();
    
    // Memory
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_percent = (memory_used as f32 / memory_total as f32) * 100.0;
    
    // Disk (root partition)
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let (disk_used, disk_total) = disks
        .iter()
        .find(|d| d.mount_point() == std::path::Path::new("/"))
        .map(|d| (d.total_space() - d.available_space(), d.total_space()))
        .unwrap_or((0, 1));
    let disk_percent = (disk_used as f32 / disk_total as f32) * 100.0;
    
    SystemStats {
        cpu,
        memory_used,
        memory_total,
        memory_percent,
        disk_used,
        disk_total,
        disk_percent,
    }
}

#[tauri::command]
fn toggle_task(project_id: String, task_index: usize) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let projects_dir = PathBuf::from(&home).join(".openclaw/workspace/projects");
    let file_path = projects_dir.join(format!("{}.md", project_id));

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read project file: {}", e))?;

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut task_num = 0;

    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if trimmed.starts_with("- [") {
            if task_num == task_index {
                if trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]") {
                    *line = line.replacen("- [x]", "- [ ]", 1).replacen("- [X]", "- [ ]", 1);
                } else if trimmed.starts_with("- [ ]") {
                    *line = line.replacen("- [ ]", "- [x]", 1);
                }
                break;
            }
            task_num += 1;
        }
    }

    fs::write(&file_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write project file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_projects() -> Vec<Project> {
    let home = std::env::var("HOME").unwrap_or_default();
    let projects_dir = PathBuf::from(&home).join(".openclaw/workspace/projects");
    
    let mut projects = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    let project = parse_project(&content, &path);
                    projects.push(project);
                }
            }
        }
    }
    
    // Sort by status (active first)
    projects.sort_by(|a, b| {
        let a_active = a.status.to_lowercase().contains("active");
        let b_active = b.status.to_lowercase().contains("active");
        b_active.cmp(&a_active)
    });
    
    projects
}

fn parse_project(content: &str, path: &PathBuf) -> Project {
    let lines: Vec<&str> = content.lines().collect();
    
    // Get name from first H1 or filename
    let name = lines.iter()
        .find(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches("# ").to_string())
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default()
        });
    
    // Get status from "Status: X" line
    let status = lines.iter()
        .find(|l| l.to_lowercase().starts_with("status:"))
        .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    
    // Get category from "Category: X" line
    let category = lines.iter()
        .find(|l| l.to_lowercase().starts_with("category:"))
        .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
        .unwrap_or_else(|| "personal".to_string());
    
    // Get description from ## Description section or first paragraph
    let description = extract_section(content, "Description")
        .or_else(|| {
            lines.iter()
                .skip_while(|l| l.starts_with('#') || l.starts_with("Status:") || l.starts_with("Created:") || l.starts_with("Priority:") || l.is_empty())
                .next()
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    
    // Extract tasks
    let tasks: Vec<Task> = lines.iter()
        .filter(|l| l.trim().starts_with("- ["))
        .map(|l| {
            let trimmed = l.trim();
            let done = trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]");
            let text = trimmed
                .trim_start_matches("- [x] ")
                .trim_start_matches("- [X] ")
                .trim_start_matches("- [ ] ")
                .to_string();
            Task { text, done }
        })
        .collect();
    
    let task_count = tasks.len();
    let tasks_done = tasks.iter().filter(|t| t.done).count();
    
    // Generate ID from filename
    let id = path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    
    Project {
        id,
        name,
        status,
        category,
        description,
        task_count,
        tasks_done,
        tasks,
    }
}

fn extract_section(content: &str, section: &str) -> Option<String> {
    let header = format!("## {}", section);
    let mut in_section = false;
    let mut result = Vec::new();
    
    for line in content.lines() {
        if line.starts_with(&header) {
            in_section = true;
            continue;
        }
        if in_section {
            if line.starts_with("## ") {
                break;
            }
            if !line.is_empty() && result.is_empty() {
                result.push(line.to_string());
                break; // Just get first line of description
            }
        }
    }
    
    if result.is_empty() { None } else { Some(result.join(" ")) }
}

#[derive(Serialize)]
pub struct GatewayConfig {
    token: String,
    port: u16,
}

#[tauri::command]
fn get_gateway_config() -> Result<GatewayConfig, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let config_path = PathBuf::from(&home).join(".openclaw/openclaw.json");
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read openclaw.json: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse openclaw.json: {}", e))?;
    
    let token = json["gateway"]["auth"]["token"]
        .as_str()
        .ok_or("gateway.auth.token not found in config")?
        .to_string();
    let port = json["gateway"]["port"]
        .as_u64()
        .ok_or("gateway.port not found in config")? as u16;
    
    Ok(GatewayConfig { token, port })
}


#[derive(Serialize)]
pub struct TickerData {
    symbol: String,
    label: String,
    price: String,
    change: f64,
}

#[tauri::command]
async fn fetch_tickers() -> Vec<TickerData> {
    let mut results = Vec::new();
    let client = reqwest::Client::new();

    // Bitcoin from Yahoo Finance (BTC-USD)
    match client.get("https://query2.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=2d")
        .header("User-Agent", "Mozilla/5.0")
        .send().await {
        Ok(resp) => {
            match resp.json::<serde_json::Value>().await {
                Ok(data) => {
                    eprintln!("BTC data keys: {:?}", data["chart"]["result"][0]["meta"].as_object().map(|m| m.keys().collect::<Vec<_>>()));
                    if let Some(meta) = data["chart"]["result"][0]["meta"].as_object() {
                        let price = meta.get("regularMarketPrice").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let prev = meta.get("chartPreviousClose").and_then(|v| v.as_f64())
                            .or_else(|| meta.get("previousClose").and_then(|v| v.as_f64())).unwrap_or(0.0);
                        let change = if prev > 0.0 { ((price - prev) / prev) * 100.0 } else { 0.0 };
                        eprintln!("BTC price: {}, prev: {}, change: {}", price, prev, change);
                        let p = price as i64;
                        let formatted = if p >= 1000 {
                            format!("${},{:03}", p / 1000, p % 1000)
                        } else {
                            format!("${}", p)
                        };
                        results.push(TickerData {
                            symbol: "₿".into(),
                            label: "BTC".into(),
                            price: formatted,
                            change,
                        });
                    } else {
                        eprintln!("BTC: meta not found");
                    }
                }
                Err(e) => eprintln!("BTC json parse error: {}", e),
            }
        }
        Err(e) => eprintln!("BTC fetch error: {}", e),
    }

    // TSLA from Yahoo Finance
    if let Ok(resp) = client.get("https://query2.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=2d")
        .header("User-Agent", "Mozilla/5.0")
        .send().await {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if let Some(meta) = data["chart"]["result"][0]["meta"].as_object() {
                let price = meta.get("regularMarketPrice").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let prev = meta.get("chartPreviousClose").and_then(|v| v.as_f64())
                    .or_else(|| meta.get("previousClose").and_then(|v| v.as_f64())).unwrap_or(0.0);
                let change = if prev > 0.0 { ((price - prev) / prev) * 100.0 } else { 0.0 };
                if price > 0.0 {
                    results.push(TickerData {
                        symbol: "⚡".into(),
                        label: "TSLA".into(),
                        price: format!("${:.2}", price),
                        change,
                    });
                }
            }
        }
    }

    // Silver from Yahoo Finance
    if let Ok(resp) = client.get("https://query2.finance.yahoo.com/v8/finance/chart/SI=F?interval=1d&range=2d")
        .header("User-Agent", "Mozilla/5.0")
        .send().await {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if let Some(meta) = data["chart"]["result"][0]["meta"].as_object() {
                let price = meta.get("regularMarketPrice").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let prev = meta.get("chartPreviousClose").and_then(|v| v.as_f64())
                    .or_else(|| meta.get("previousClose").and_then(|v| v.as_f64())).unwrap_or(0.0);
                let change = if prev > 0.0 { ((price - prev) / prev) * 100.0 } else { 0.0 };
                if price > 0.0 {
                    results.push(TickerData {
                        symbol: "🪙".into(),
                        label: "Silver".into(),
                        price: format!("${:.2}", price),
                        change,
                    });
                }
            }
        }
    }

    results
}

static RECORDING_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

#[tauri::command]
fn toggle_input_mute(state: bool) -> Result<String, String> {
    // First attempt: direct command with osascript
    let script = if state {
        "set volume input volume 0\n" // Direct mute input volume
    } else {
        "set volume input volume 100\n" // Direct unmute input volume
    };
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();
    match output {
        Ok(output) => {
            if output.status.success() {
                return Ok(format!("Input mute set to {} via direct command", state));
            }
        },
        Err(_) => {}
    }
    // Fallback: try a shell command with osascript and detailed error logging
    let fallback_script = if state {
        "tell application \"System Events\" to set volume with input muted\n" // Fallback: try muted flag
    } else {
        "tell application \"System Events\" to set volume without input muted\n" // Fallback: unmute
    };
    let fallback_output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(fallback_script)
        .output();
    match fallback_output {
        Ok(output) => {
            if output.status.success() {
                return Ok(format!("Input mute set to {} via fallback command", state));
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                // Log detailed error for debugging
                eprintln!("Fallback mute command failed: stderr={}, stdout={}", stderr, stdout);
                // Final fallback: log for debugging purposes
                Err(format!("Failed to set mute with fallback: stderr={}, stdout={}", stderr, stdout))
            }
        },
        Err(e) => {
            eprintln!("Fallback command execution error: {}", e);
            Err(format!("Fallback command error: {}", e.to_string()))
        },
    }
}

#[tauri::command]
fn start_voice_input() -> Result<String, String> {
    let tmp_path = std::env::temp_dir().join("dashboard_voice.wav");
    
    // Start recording with sox
    let child = Command::new("/opt/homebrew/bin/sox")
        .args([
            "-d",                           // default input device
            "-r", "16000",                  // 16kHz sample rate (whisper expects this)
            "-c", "1",                      // mono
            "-b", "16",                     // 16-bit
            tmp_path.to_str().unwrap(),
        ])
        .spawn()
        .map_err(|e| format!("Failed to start recording: {}", e))?;
    
    let mut proc = RECORDING_PROCESS.lock().unwrap();
    *proc = Some(child);
    
    Ok("Recording started".to_string())
}

#[tauri::command]
fn stop_voice_input() -> Result<String, String> {
    // Stop the recording
    {
        let mut proc = RECORDING_PROCESS.lock().unwrap();
        if let Some(ref mut child) = *proc {
            // Send SIGTERM to stop sox gracefully
            let _ = Command::new("kill")
                .arg(child.id().to_string())
                .output();
            let _ = child.wait();
        }
        *proc = None;
    }
    
    let tmp_path = std::env::temp_dir().join("dashboard_voice.wav");
    
    if !tmp_path.exists() {
        return Err("No recording found".to_string());
    }
    
    // Transcribe with whisper-cpp
    let home = std::env::var("HOME").unwrap_or_default();
    let model_path = format!("{}/.local/share/whisper/ggml-base.en.bin", home);
    
    let output = Command::new("/opt/homebrew/bin/whisper-cli")
        .args([
            "--model", &model_path,
            "--no-timestamps",
            "--no-prints",
            "--file", tmp_path.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("Failed to run whisper: {}", e))?;
    
    // Clean up the temp file
    let _ = fs::remove_file(&tmp_path);
    
    if output.status.success() {
        let transcript = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|l| {
                let trimmed = l.trim();
                !trimmed.is_empty() 
                    && !trimmed.contains("whisper_") 
                    && !trimmed.contains("system_info")
                    && !trimmed.contains("ggml_")
                    && !trimmed.contains("main:")
                    && trimmed != "[BLANK_AUDIO]"
            })
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
        Ok(transcript)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Transcription failed: {}", stderr))
    }
}

#[tauri::command]
async fn speak_text(text: String) -> Result<String, String> {
    let tmp_path = std::env::temp_dir().join("larry_tts.wav");
    let home = std::env::var("HOME").unwrap_or_default();
    let model_dir = format!("{}/.local/share/sherpa-onnx-tts/vits-piper-en_US-lessac-medium", home);
    
    // Use sherpa-onnx via Python for local TTS
    let script = format!(
        r#"
import sherpa_onnx, soundfile as sf
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model='{model_dir}/en_US-lessac-medium.onnx',
            tokens='{model_dir}/tokens.txt',
            data_dir='{model_dir}/espeak-ng-data',
        ),
    ),
))
audio = tts.generate('''{text}''')
sf.write('{out}', audio.samples, audio.sample_rate)
"#,
        model_dir = model_dir,
        text = text.replace('\'', "\\'").replace('\n', " "),
        out = tmp_path.to_str().unwrap(),
    );
    
    let output = Command::new("python3")
        .args(["-c", &script])
        .output()
        .map_err(|e| format!("Failed to run TTS: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("TTS failed: {}", stderr));
    }
    
    // Kill any existing TTS playback before starting new one
    let _ = Command::new("pkill").args(["-f", "afplay.*larry_tts"]).output();
    
    // Play the audio
    Command::new("afplay")
        .arg(tmp_path.to_str().unwrap())
        .spawn()
        .map_err(|e| format!("Failed to play audio: {}", e))?;
    
    Ok("Speaking".to_string())
}

#[tauri::command]
async fn fetch_coinbase() -> Result<String, String> {
    let output = Command::new("python3")
        .arg("/Users/jadmin/.config/finance-dashboard/fetch-coinbase.py")
        .output()
        .map_err(|e| format!("Failed to run fetch: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Fetch failed: {}", stderr));
    }
    
    String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8: {}", e))
}

#[tauri::command]
async fn read_coinbase_data() -> Result<String, String> {
    let path = format!("{}/.config/finance-dashboard/coinbase-balances.json",
        std::env::var("HOME").unwrap_or_default());
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read: {}", e))
}

#[tauri::command]
async fn fetch_strike() -> Result<String, String> {
    let output = Command::new("python3")
        .arg("/Users/jadmin/.config/finance-dashboard/fetch-strike.py")
        .output()
        .map_err(|e| format!("Failed to run fetch: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Fetch failed: {}", stderr));
    }
    
    String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8: {}", e))
}

#[tauri::command]
async fn read_strike_data() -> Result<String, String> {
    let path = format!("{}/.config/finance-dashboard/strike-balances.json",
        std::env::var("HOME").unwrap_or_default());
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read: {}", e))
}

// ─── SnapTrade: signed requests from Rust to avoid CORS ──────────────────────

#[tauri::command]
async fn fetch_snaptrade_accounts(
    client_id: String,
    consumer_key: String,
    user_id: String,
    user_secret: String,
) -> Result<String, String> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use base64::{Engine as _, engine::general_purpose};

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string();

    // Query string — all 4 params in URL, per SnapTrade SDK
    let query_string = format!(
        "clientId={}&timestamp={}&userId={}&userSecret={}",
        client_id, timestamp, user_id, user_secret
    );

    // Sign a request: HMAC-SHA256(key=consumerKey, data=JSON sig_object) → base64 STANDARD
    // sig_object keys must be alphabetically ordered: content, path, query
    // content must be null (not {}) for GET requests with no body
    let make_sig = |path: &str| -> Result<String, String> {
        let sig_content = format!(
            r#"{{"content":null,"path":"{}","query":"{}"}}"#,
            path, query_string
        );
        let mut mac = Hmac::<Sha256>::new_from_slice(consumer_key.as_bytes())
            .map_err(|e| format!("HMAC init error: {}", e))?;
        mac.update(sig_content.as_bytes());
        Ok(general_purpose::STANDARD.encode(mac.finalize().into_bytes()))
    };

    let client = reqwest::Client::new();

    // Fetch accounts list — each path gets its own signature
    let accounts_path = "/api/v1/accounts";
    let accounts_url = format!("https://api.snaptrade.com{}?{}", accounts_path, query_string);
    let accounts_sig = make_sig(accounts_path)?;

    let accounts_resp = client
        .get(&accounts_url)
        .header("Client-Id", &client_id)
        .header("Timestamp", &timestamp)
        .header("Signature", &accounts_sig)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("accounts fetch error: {}", e))?;

    if !accounts_resp.status().is_success() {
        let status = accounts_resp.status().as_u16();
        let body = accounts_resp.text().await.unwrap_or_default();
        return Err(format!("accounts HTTP {}: {}", status, body));
    }

    let accounts: serde_json::Value = accounts_resp
        .json()
        .await
        .map_err(|e| format!("accounts parse error: {}", e))?;

    let account_list = accounts.as_array().cloned().unwrap_or_default();

    // For each account, fetch balances + positions in parallel
    let mut enriched: Vec<serde_json::Value> = Vec::new();
    for acct in account_list {
        let acct_id = acct["id"].as_str().unwrap_or("").to_string();
        if acct_id.is_empty() {
            enriched.push(serde_json::json!({
                "account": acct,
                "balances": [],
                "positions": [],
            }));
            continue;
        }

        let balances_path = format!("/api/v1/accounts/{}/balances", acct_id);
        let positions_path = format!("/api/v1/accounts/{}/positions", acct_id);

        let balances_url = format!("https://api.snaptrade.com{}?{}", balances_path, query_string);
        let positions_url = format!("https://api.snaptrade.com{}?{}", positions_path, query_string);

        let balances_sig = make_sig(&balances_path)?;
        let positions_sig = make_sig(&positions_path)?;

        let (bal_res, pos_res) = tokio::join!(
            client
                .get(&balances_url)
                .header("Client-Id", &client_id)
                .header("Timestamp", &timestamp)
                .header("Signature", &balances_sig)
                .header("Accept", "application/json")
                .send(),
            client
                .get(&positions_url)
                .header("Client-Id", &client_id)
                .header("Timestamp", &timestamp)
                .header("Signature", &positions_sig)
                .header("Accept", "application/json")
                .send()
        );

        let balances: serde_json::Value = match bal_res {
            Ok(r) if r.status().is_success() => r.json().await.unwrap_or(serde_json::json!([])),
            Ok(r) => {
                eprintln!("balances HTTP {}", r.status());
                serde_json::json!([])
            }
            Err(e) => {
                eprintln!("balances fetch error: {}", e);
                serde_json::json!([])
            }
        };

        let positions: serde_json::Value = match pos_res {
            Ok(r) if r.status().is_success() => r.json().await.unwrap_or(serde_json::json!([])),
            Ok(r) => {
                eprintln!("positions HTTP {}", r.status());
                serde_json::json!([])
            }
            Err(e) => {
                eprintln!("positions fetch error: {}", e);
                serde_json::json!([])
            }
        };

        enriched.push(serde_json::json!({
            "account": acct,
            "balances": balances,
            "positions": positions,
        }));
    }

    serde_json::to_string(&enriched)
        .map_err(|e| format!("JSON serialization error: {}", e))
}

// ─── Fidelity CSV Import ──────────────────────────────────────────────────────

#[derive(Serialize)]
struct FidelityPosition {
    symbol: String,
    description: String,
    quantity: f64,
    #[serde(rename = "lastPrice")]
    last_price: f64,
    #[serde(rename = "currentValue")]
    current_value: f64,
    #[serde(rename = "totalGainLoss")]
    total_gain_loss: f64,
    #[serde(rename = "avgCostBasis")]
    avg_cost_basis: f64,
    #[serde(rename = "isCash")]
    is_cash: bool,
}

#[derive(Serialize)]
struct FidelityAccountRaw {
    #[serde(rename = "accountName")]
    account_name: String,
    #[serde(rename = "accountNumber")]
    account_number: String,
    positions: Vec<FidelityPosition>,
}

fn parse_money(s: &str) -> f64 {
    let cleaned: String = s.chars().filter(|c| *c != '$' && *c != ',' && *c != '+').collect();
    cleaned.trim().parse::<f64>().unwrap_or(0.0)
}

#[tauri::command]
fn read_fidelity_csv() -> Result<String, String> {
    // Look for CSV files in known path
    let home = std::env::var("HOME").unwrap_or_default();
    let data_dir = PathBuf::from(&home).join("projects/dashboard-app/src/data");

    let mut csv_path: Option<PathBuf> = None;
    if let Ok(entries) = fs::read_dir(&data_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("Portfolio_Positions_") && name.ends_with(".csv") {
                // Pick the latest one alphabetically
                if csv_path.as_ref().map_or(true, |p| entry.path() > *p) {
                    csv_path = Some(entry.path());
                }
            }
        }
    }

    let csv_path = csv_path.ok_or("No Portfolio_Positions_*.csv found in src/data/")?;
    let content = fs::read_to_string(&csv_path)
        .map_err(|e| format!("Failed to read CSV: {}", e))?;

    // Remove BOM if present
    let content = content.trim_start_matches('\u{feff}');

    let mut accounts: Vec<(String, FidelityAccountRaw)> = Vec::new();

    for (i, line) in content.lines().enumerate() {
        if i == 0 { continue; } // skip header
        let line = line.trim();
        if line.is_empty() { continue; }

        // Skip footer disclaimer lines — they start with " or don't have enough commas
        if line.starts_with('"') || line.starts_with("The data") || line.starts_with("Brokerage") || line.starts_with("Date downloaded") {
            continue;
        }

        // Parse CSV (simple split — no quoted commas in this data except description which won't have commas)
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 16 { continue; }

        let account_number = cols[0].trim().to_string();
        let account_name = cols[1].trim().to_string();
        let symbol = cols[2].trim().to_string();
        let description = cols[3].trim().to_string();

        // Skip if account_number looks invalid
        if account_number.is_empty() || account_name.is_empty() {
            continue;
        }

        let quantity = parse_money(cols[4]);
        let last_price = parse_money(cols[5]);
        let current_value = parse_money(cols[7]);
        let total_gain_loss = parse_money(cols[10]);
        let avg_cost_basis = parse_money(cols[14]);

        let is_cash = symbol.contains("SPAXX") || symbol.contains("FDRXX") ||
            description.to_uppercase().contains("MONEY MARKET");

        let pos = FidelityPosition {
            symbol,
            description,
            quantity,
            last_price,
            current_value,
            total_gain_loss,
            avg_cost_basis,
            is_cash,
        };

        let key = format!("{}-{}", account_number, account_name);
        if let Some(entry) = accounts.iter_mut().find(|(k, _)| k == &key) {
            entry.1.positions.push(pos);
        } else {
            accounts.push((key, FidelityAccountRaw {
                account_name: account_name.clone(),
                account_number: account_number.clone(),
                positions: vec![pos],
            }));
        }
    }

    let result: Vec<&FidelityAccountRaw> = accounts.iter().map(|(_, v)| v).collect();
    serde_json::to_string(&result).map_err(|e| format!("JSON error: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_system_stats, get_projects, toggle_task, get_gateway_config, toggle_input_mute, start_voice_input, stop_voice_input, speak_text, fetch_tickers, fetch_coinbase, read_coinbase_data, fetch_strike, read_strike_data, fetch_snaptrade_accounts, read_fidelity_csv])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
