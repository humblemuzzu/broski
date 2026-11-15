import SwiftUI

/// A screen whose content could not be read: what happened, the Mac's own words, and Try Again.
struct ProblemView: View {
    let problem: WorkspaceProblem
    let retry: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label(problem.message, systemImage: "exclamationmark.triangle")
        } description: {
            if let detail = problem.detail {
                Text(detail).font(.codeSmall)
            }
        } actions: {
            Button("Try Again") { Task { await retry() } }
        }
    }
}

extension Banner where Action == EmptyView {
    /// A request that failed on a screen that stays usable.
    init(problem: WorkspaceProblem) {
        self.init(style: .error, message: problem.message, detail: problem.detail)
    }
}
