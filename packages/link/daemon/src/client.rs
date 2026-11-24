use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::cli::{HomeArgs, OutputArgs, RevokeArgs};
use crate::{clock, config, qr};

const TIMEOUT: Duration = Duration::from_secs(10);

pub fn pair(args: HomeArgs) -> Result<String, String> {
    let reply = request(&config::home(args.home), &json!({"cmd": "pair"}))?;
    let Some(uri) = reply.get("uri").and_then(Value::as_str) else {
        return Err(error(&reply));
    };
    let mut out = String::new();
    if let Some(code) = qr::render(uri) {
        out.push_str(&code);
        out.push('\n');
    }
    out.push_str(uri);
    out.push('\n');
    if let Some(code) = reply.get("code").and_then(Value::as_str) {
        out.push_str(&format!(
            "Mac code  {code}  (check your phone shows the same)\n"
        ));
    }
    if let Some(expires_at) = reply.get("expires_at").and_then(Value::as_u64) {
        let remaining = expires_at.saturating_sub(clock::unix_secs());
        out.push_str(&format!("valid for {remaining}s\n"));
    }
    Ok(out)
}

pub fn status(args: OutputArgs) -> Result<String, String> {
    let home = config::home(args.home.home);
    let reply = request(&home, &json!({"cmd": "status"}))?;
    if args.json {
        return Ok(format!("{reply}\n"));
    }
    if reply.get("error").is_some() {
        return Err(error(&reply));
    }
    let machine = &reply["machine"];
    let bridge = &reply["bridge"];
    let mut out = format!(
        "machine   {}  {}\nrelay     {}\nlan       {}\nbridge    {}{}\n",
        text(&machine["id"]),
        text(&machine["name"]),
        if reply["relay_connected"].as_bool().unwrap_or(false) {
            "connected"
        } else {
            "not connected"
        },
        list(&reply["lan"]),
        text(&bridge["state"]),
        match bridge["detail"].as_str() {
            Some(detail) => format!(" ({detail})"),
            None => String::new(),
        },
    );
    let sessions = reply["sessions"].as_array().cloned().unwrap_or_default();
    if sessions.is_empty() {
        out.push_str("sessions  none\n");
    }
    for session in sessions {
        out.push_str(&format!(
            "session   {}  {}  {}\n",
            text(&session["device"]),
            session["route"].as_str().unwrap_or("detached"),
            if session["connected"].as_bool().unwrap_or(false) {
                "connected"
            } else {
                "detached"
            },
        ));
    }
    Ok(out)
}

pub fn devices(args: OutputArgs) -> Result<String, String> {
    let home = config::home(args.home.home);
    let reply = request(&home, &json!({"cmd": "devices"}))?;
    if args.json {
        return Ok(format!("{reply}\n"));
    }
    let entries = reply.as_array().cloned().unwrap_or_default();
    if entries.is_empty() {
        return Ok("no paired devices\n".to_owned());
    }
    let mut out = String::new();
    for device in entries {
        out.push_str(&format!(
            "{}  {}  {}  {}\n",
            text(&device["id"]),
            text(&device["name"]),
            text(&device["platform"]),
            age(device["paired_at"].as_u64().unwrap_or_default()),
        ));
    }
    Ok(out)
}

pub fn revoke(args: RevokeArgs) -> Result<String, String> {
    let home = config::home(args.home.home);
    let reply = request(&home, &json!({"cmd": "revoke", "device": args.device}))?;
    match reply.get("device").and_then(Value::as_str) {
        Some(device) => Ok(format!("revoked {device}\n")),
        None => Err(error(&reply)),
    }
}

fn request(home: &Path, request: &Value) -> Result<Value, String> {
    let path = crate::control_socket::path(home);
    let stream = UnixStream::connect(&path).map_err(|error| {
        format!(
            "the daemon is not running ({}: {error}); start it with `broski-link run`",
            path.display()
        )
    })?;
    stream
        .set_read_timeout(Some(TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(TIMEOUT))
        .map_err(|error| error.to_string())?;
    let mut writer = stream.try_clone().map_err(|error| error.to_string())?;
    writeln!(writer, "{request}").map_err(|error| error.to_string())?;
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&line)
        .map_err(|error| format!("unexpected reply from the daemon: {error}"))
}

fn error(reply: &Value) -> String {
    reply
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("the daemon sent an unexpected reply")
        .to_owned()
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("-")
}

fn list(value: &Value) -> String {
    match value.as_array().filter(|entries| !entries.is_empty()) {
        Some(entries) => entries
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", "),
        None => "none".to_owned(),
    }
}

fn age(paired_at: u64) -> String {
    let seconds = clock::unix_secs().saturating_sub(paired_at);
    match seconds {
        0..=59 => format!("{seconds}s ago"),
        60..=3599 => format!("{}m ago", seconds / 60),
        3600..=86_399 => format!("{}h ago", seconds / 3600),
        _ => format!("{}d ago", seconds / 86_400),
    }
}
