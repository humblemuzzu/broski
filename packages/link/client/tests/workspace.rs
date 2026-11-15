//! The machine's files, git and terminals through the real bridge.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use broski_client::{Machine, TerminalUpdate, TerminalView};
use broski_contract::{
    ActionResult, ClientMessage, FileEncoding, FileRead, FsListRequest, FsListResult,
    FsReadRequest, FsReadResult, GitChange, GitStatusRequest, GitStatusResult, ServerMessage,
    TermListRequest, TermListResult, TermOpenRequest, TermOpenResult, TerminalId, WorkspaceInfo,
    WorkspaceInfoRequest, WorkspaceInfoResult,
};
use broski_link_testkit::relay::TestRelay;
use broski_link_testkit::WAIT;
use common::{answer, paired, phone, ready, requests_sent, status_until, Mac};
use tokio::time::{timeout_at, Instant};

/// git as the test runs it: no global or system configuration of the machine running the tests.
fn git(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .current_dir(repo)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?}");
}

/// A repository in the bridge's home with one commit, and its README changed since.
fn repository(mac: &Mac) -> PathBuf {
    let repo = mac.root().join("repo");
    std::fs::create_dir(&repo).expect("the repository");
    git(&repo, &["init", "-q"]);
    std::fs::write(repo.join("README.md"), "hello\n").expect("a file");
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-q", "-m", "first"]);
    std::fs::write(repo.join("README.md"), "hello again\n").expect("a change");
    repo
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

async fn workspace_info(machine: &Machine) -> WorkspaceInfo {
    let info = ClientMessage::WorkspaceInfo(WorkspaceInfoRequest {
        request_id: String::new(),
    });
    answer(machine, info, |answer| match answer {
        ServerMessage::WorkspaceInfoResult(answer) => match answer.result {
            WorkspaceInfoResult::Accepted(info) => Some(info),
            WorkspaceInfoResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await
}

async fn names_in(machine: &Machine, directory: &Path) -> Vec<String> {
    let list = ClientMessage::FsList(FsListRequest {
        request_id: String::new(),
        path: text(directory),
        cursor: None,
        limit: None,
        hidden: None,
    });
    let listed = answer(machine, list, |answer| match answer {
        ServerMessage::FsListResult(answer) => match answer.result {
            FsListResult::Accepted(listed) => Some(listed),
            FsListResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await;
    listed.entries.into_iter().map(|entry| entry.name).collect()
}

async fn read_file(machine: &Machine, file: &Path) -> FileRead {
    let read = ClientMessage::FsRead(FsReadRequest {
        request_id: String::new(),
        path: text(file),
        offset: None,
        length: None,
    });
    answer(machine, read, |answer| match answer {
        ServerMessage::FsReadResult(answer) => match answer.result {
            FsReadResult::Accepted(read) => Some(read),
            FsReadResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn files_are_listed_and_read_through_the_bridge() {
    let mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let repo = repository(&mac);
    let info = workspace_info(&machine).await;
    assert!(info.git && info.terminal);
    assert!(info.roots.contains(&mac.root_text()));
    let names = names_in(&machine, &repo).await;
    assert_eq!(names, ["README.md"], "the .git directory is hidden");
    let read = read_file(&machine, &repo.join("README.md")).await;
    assert_eq!(read.encoding, FileEncoding::Utf8);
    assert_eq!(read.content, "hello again\n");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn git_status_reports_the_changed_file() {
    let mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let repo = repository(&mac);
    let status = ClientMessage::GitStatus(GitStatusRequest {
        request_id: String::new(),
        cwd: text(&repo),
    });
    let status = answer(&machine, status, |answer| match answer {
        ServerMessage::GitStatusResult(answer) => match answer.result {
            GitStatusResult::Accepted(status) => Some(status),
            GitStatusResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await;
    let unstaged: Vec<(&str, GitChange)> = status
        .unstaged
        .iter()
        .map(|change| (change.path.as_str(), change.change))
        .collect();
    assert_eq!(unstaged, [("README.md", GitChange::Modified)]);
    assert!(status.staged.is_empty() && status.untracked.is_empty());
}

/// What the emulator behind a view shows: the output handed over since the last reset, and how
/// many of its updates said reset.
struct Screen {
    view: Arc<TerminalView>,
    bytes: Vec<u8>,
    resets: usize,
}

impl Screen {
    fn of(view: Arc<TerminalView>) -> Screen {
        Screen {
            view,
            bytes: Vec::new(),
            resets: 0,
        }
    }

    async fn until(&mut self, what: &str, text: &str) {
        let deadline = Instant::now() + WAIT;
        while !String::from_utf8_lossy(&self.bytes).contains(text) {
            let update = timeout_at(deadline, self.view.next_update())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
                .expect("the terminal goes on");
            match update {
                TerminalUpdate::Output { data, reset } => {
                    if reset {
                        self.resets += 1;
                        self.bytes.clear();
                    }
                    self.bytes.extend(data);
                }
                other => panic!("waiting for {what}: {other:?}"),
            }
        }
    }

    fn count(&self, text: &str) -> usize {
        String::from_utf8_lossy(&self.bytes).matches(text).count()
    }
}

async fn open_terminal(machine: &Machine, cwd: &Path) -> TerminalId {
    let open = ClientMessage::TermOpen(TermOpenRequest {
        request_id: String::new(),
        cwd: text(cwd),
        cols: 80,
        rows: 24,
        cell_width: None,
        cell_height: None,
    });
    answer(machine, open, |answer| match answer {
        ServerMessage::TermOpenResult(answer) => match answer.result {
            TermOpenResult::Accepted(opened) => Some(opened.terminal.id),
            TermOpenResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await
}

async fn columns(machine: &Machine) -> i64 {
    let list = ClientMessage::TermList(TermListRequest {
        request_id: String::new(),
    });
    answer(machine, list, |answer| match answer {
        ServerMessage::TermListResult(answer) => match answer.result {
            TermListResult::Accepted(listed) => {
                listed.terminals.first().map(|terminal| terminal.cols)
            }
            TermListResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await
}

/// Waits until the shell, writing as it goes, has put `lines` lines into `file`.
async fn written(file: &Path, lines: usize) {
    let deadline = Instant::now() + WAIT;
    while std::fs::read_to_string(file).map_or(0, |text| text.lines().count()) < lines {
        assert!(
            Instant::now() < deadline,
            "the shell never wrote {lines} lines"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn accepted(result: Result<ActionResult, broski_client::ClientError>) -> bool {
    matches!(result, Ok(ActionResult::Accepted(_)))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_terminal_echoes_input_and_takes_a_resize() {
    let mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let id = open_terminal(&machine, &mac.root()).await;
    let view = Arc::clone(&machine).terminal(id).expect("a view");
    let mut screen = Screen::of(view);
    assert!(accepted(
        screen.view.input(b"echo hi-there\n".to_vec()).await
    ));
    screen.until("the echo", "\nhi-there\r\n").await;
    assert!(accepted(
        screen.view.resize(100, 30, Some(8), Some(16)).await
    ));
    assert_eq!(columns(&machine).await, 100);
    assert_eq!(
        screen.resets, 1,
        "only the first output starts the emulator"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_terminal_reattached_after_a_machine_restart_gets_only_what_it_missed() {
    let relay = TestRelay::start().await;
    let mut mac = Mac::on_relay(&relay).await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let id = open_terminal(&machine, &mac.root()).await;
    let view = Arc::clone(&machine).terminal(id.clone()).expect("a view");
    let mut screen = Screen::of(view);
    let looping = b"for i in $(seq 1 60); do echo line$i; echo $i >> progress; sleep 0.02; done; echo fin$((1+1))\n";
    assert!(accepted(screen.view.input(looping.to_vec()).await));
    screen.until("the loop to start", "line1\r\n").await;
    mac.stop_daemon().await;
    written(&mac.root().join("progress"), 30).await;
    mac.start_daemon().await;
    status_until(&machine, "a new link session and bridge socket", ready).await;
    screen.until("the loop to finish", "\nfin2\r\n").await;
    assert_eq!(
        screen.resets, 1,
        "the reattach continued where the view stood"
    );
    for line in 1..=60 {
        assert_eq!(
            screen.count(&format!("line{line}\r\n")),
            1,
            "line{line} once"
        );
    }

    let fresh = Arc::clone(&machine).terminal(id).expect("another view");
    let Some(TerminalUpdate::Output { data, reset: true }) = fresh.next_update().await else {
        panic!("the whole replay");
    };
    assert!(
        data.starts_with(&screen.bytes),
        "the first view's bytes are the terminal's, none missing or repeated"
    );
    relay.stop().await;
}

/// The numbers a screen shows, one per line, after its first line (a reset may cut it short).
fn numbered_lines(screen: &Screen) -> Vec<u64> {
    String::from_utf8_lossy(&screen.bytes)
        .split("\r\n")
        .skip(1)
        .filter_map(|line| line.parse().ok())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_terminal_that_outruns_an_idle_ui_keeps_the_newest_output_without_asking_the_bridge_again(
) {
    const LAST: u64 = 200_000;
    let mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let id = open_terminal(&machine, &mac.root()).await;
    let view = Arc::clone(&machine).terminal(id).expect("a view");
    let mut screen = Screen::of(view);
    let first = requests_sent(&machine).await;

    // About three times what the bridge replays, written while the UI pulls nothing.
    let spew = format!("seq 1 {LAST}; echo ok > spewed; echo after$((20+22))\n");
    assert!(accepted(screen.view.input(spew.into_bytes()).await));
    written(&mac.root().join("spewed"), 1).await;
    // An answer follows every frame the bridge sent before it on the socket: the spew has reached
    // the phone, and the UI pulled none of it.
    requests_sent(&machine).await;

    screen
        .until("the output after the spew", "after42\r\n")
        .await;
    let shown = numbered_lines(&screen);
    assert_eq!(shown.last(), Some(&LAST));
    assert!(
        shown.windows(2).all(|pair| pair[1] == pair[0] + 1),
        "the newest output, none missing or repeated"
    );
    assert!(
        shown.len() < LAST as usize / 2,
        "the UI starts over from the newest output, not from the first line"
    );
    let last = requests_sent(&machine).await;
    assert_eq!(
        last - first,
        3,
        "the input and the two probes are all the machine sent: no attach again"
    );

    assert!(accepted(
        screen.view.input(b"echo later$((2+2))\n".to_vec()).await
    ));
    screen
        .until("the output after the recovery", "later4\r\n")
        .await;
}
