//! What a fold's sentence counts: "Edited 1 file · Ran 2 commands".

use std::collections::HashSet;

use super::ToolKind;

/// A verb of the fold's sentence, most consequential first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldVerb {
    Edited,
    Ran,
    Read,
    Searched,
    Fetched,
    Delegated,
    /// The calls no other verb names, and the verbs past the shown ones.
    Used,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FoldCount {
    pub verb: FoldVerb,
    pub count: u32,
}

/// A call of the stretch, its own and not a subagent's.
#[derive(Debug, Clone, PartialEq)]
pub struct FoldTool {
    pub id: String,
    pub kind: ToolKind,
    /// `ToolLook::paths`.
    pub paths: Vec<String>,
}

/// At most this many verbs, so the sentence stays one line; the rest fold into `Used`.
const SHOWN_VERBS: usize = 2;

/// The verbs a stretch's calls add up to. Files count once however often they are read or edited,
/// and a file that was edited is not also counted as read; a call that names no file counts as one.
pub fn fold_counts(tools: &[FoldTool]) -> Vec<FoldCount> {
    let files = |kind: ToolKind| -> HashSet<&str> {
        tools
            .iter()
            .filter(|tool| tool.kind == kind)
            .flat_map(|tool| match tool.paths.as_slice() {
                [] => vec![tool.id.as_str()],
                paths => paths.iter().map(String::as_str).collect(),
            })
            .collect()
    };
    let calls = |kind: ToolKind| tools.iter().filter(|tool| tool.kind == kind).count();
    let edited = files(ToolKind::Edit);
    let read = files(ToolKind::Read).difference(&edited).count();
    let counted = [
        (FoldVerb::Edited, edited.len()),
        (FoldVerb::Ran, calls(ToolKind::Command)),
        (FoldVerb::Read, read),
        (FoldVerb::Searched, calls(ToolKind::Search)),
        (FoldVerb::Fetched, calls(ToolKind::Web)),
        (FoldVerb::Delegated, calls(ToolKind::Agent)),
        (FoldVerb::Used, calls(ToolKind::Other)),
    ];
    let mut counts: Vec<FoldCount> = counted
        .into_iter()
        .filter(|(_, count)| *count > 0)
        .map(|(verb, count)| FoldCount {
            verb,
            count: count as u32,
        })
        .collect();
    if counts.len() > SHOWN_VERBS {
        let rest: u32 = counts.drain(SHOWN_VERBS..).map(|count| count.count).sum();
        counts.push(FoldCount {
            verb: FoldVerb::Used,
            count: rest,
        });
    }
    counts
}
