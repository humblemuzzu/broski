//! How an activity reads in the transcript, decided once for both apps: its tone, the short facts
//! beside its title, and what it shows while closed. The apps add the icon and draw the body.

use broski_contract::{Activity, ActivityFormat, ActivityStatus};

use crate::text::{clip_text, format_duration, plain_preview, ClipEnd, TextClip};

/// Lines of a log an activity shows while open; the rest opens on a tap.
pub const LOG_LINES: u32 = 12;
/// Characters of a message's opening words shown under its title while closed.
const PREVIEW_CHARS: u32 = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityTone {
    Plain,
    /// It reported in and goes on.
    Working,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityLook {
    pub tone: ActivityTone,
    /// Beside the title: how long it took, a failed exit code ("1h 5m", "Exit 1").
    pub facts: Vec<String>,
    /// A markdown or text body's opening words, shown under the title while closed.
    pub preview: Option<String>,
    /// A log body's last lines, shown while open.
    pub log: Option<TextClip>,
    /// There is more than the title: a command, a body or a session to open.
    pub opens: bool,
}

pub fn activity_look(activity: &Activity) -> ActivityLook {
    let exit = activity.exit_code.filter(|code| *code != 0);
    let tone = match activity.status {
        Some(ActivityStatus::Failed) => ActivityTone::Failed,
        _ if exit.is_some() => ActivityTone::Failed,
        Some(ActivityStatus::Running) => ActivityTone::Working,
        _ => ActivityTone::Plain,
    };
    let duration = activity
        .duration_ms
        .filter(|ms| *ms >= 1000)
        .map(format_duration);
    let facts = duration
        .into_iter()
        .chain(exit.map(|code| format!("Exit {code}")))
        .collect();
    let body = activity.body.as_ref();
    let preview = body
        .filter(|body| body.format != ActivityFormat::Log)
        .map(|body| plain_preview(&body.text, PREVIEW_CHARS))
        .filter(|preview| !preview.is_empty());
    let log = body
        .filter(|body| body.format == ActivityFormat::Log)
        .map(|body| clip_text(&body.text, LOG_LINES, ClipEnd::Tail));
    let opens = activity
        .command
        .as_deref()
        .is_some_and(|command| !command.is_empty())
        || body.is_some()
        || activity.child_session.is_some();
    ActivityLook {
        tone,
        facts,
        preview,
        log,
        opens,
    }
}

#[cfg(test)]
mod tests {
    use broski_contract::{ActivityBody, ActivityKind};

    use super::*;

    fn activity(title: &str) -> Activity {
        Activity {
            kind: ActivityKind::Task,
            title: title.to_owned(),
            status: None,
            command: None,
            duration_ms: None,
            exit_code: None,
            body: None,
            child_session: None,
        }
    }

    #[test]
    fn a_failed_exit_or_status_reads_failed_and_says_how_long_it_took() {
        let failed = Activity {
            duration_ms: Some(3_900_000),
            exit_code: Some(1),
            ..activity("bash-6bfa failed")
        };
        let look = activity_look(&failed);
        assert_eq!(look.tone, ActivityTone::Failed);
        assert_eq!(look.facts, ["1h 5m", "Exit 1"]);
        let running = Activity {
            status: Some(ActivityStatus::Running),
            duration_ms: Some(400),
            exit_code: Some(0),
            ..activity("still going")
        };
        let look = activity_look(&running);
        assert_eq!(look.tone, ActivityTone::Working);
        assert!(look.facts.is_empty());
        assert!(!look.opens);
    }

    #[test]
    fn a_message_previews_its_words_and_a_log_shows_its_last_lines() {
        let message = Activity {
            body: Some(ActivityBody {
                format: ActivityFormat::Markdown,
                text: "**All good.** Nothing to fix.".to_owned(),
            }),
            ..activity("Review finished")
        };
        let look = activity_look(&message);
        assert_eq!(look.preview.as_deref(), Some("All good. Nothing to fix."));
        assert_eq!(look.log, None);
        assert!(look.opens);
        let log = (1..=40)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let job = Activity {
            body: Some(ActivityBody {
                format: ActivityFormat::Log,
                text: log,
            }),
            ..activity("tests failed")
        };
        let look = activity_look(&job);
        assert_eq!(look.preview, None);
        let tail = look.log.expect("the log's last lines");
        assert!(tail.text.starts_with("29\n") && tail.text.ends_with("\n40"));
        assert_eq!(tail.hidden_lines, 28);
    }
}
