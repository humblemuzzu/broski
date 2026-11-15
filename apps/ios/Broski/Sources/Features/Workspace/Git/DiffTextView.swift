import BroskiCore
import SwiftUI

/// A file of a `git.diff` answer, through the core's diff renderer (noNewline markers and word
/// emphasis added) and the shared diff view the chat uses too.
struct DiffTextView: View {
    let file: GitDiffFile
    let truncated: Bool

    var body: some View {
        DiffView(file: gitDiffFile(file: file), truncated: truncated)
    }
}
