import BroskiCore
import SwiftUI

/// One file's diff: the working tree against the index, or the index against HEAD when staged.
struct DiffScreen: View {
    let cwd: String
    let path: String
    let staged: Bool
    let requests: WorkspaceRequests
    @State private var phase: Phase = .loading
    @Environment(\.workspaceReachable) private var reachable

    enum Phase {
        case loading
        case loaded(GitDiffRead)
        case failed(WorkspaceProblem)
    }

    var body: some View {
        content
            .navigationTitle(path.lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(path.lastPathComponent).font(.headline).lineLimit(1)
                        Text(staged ? "Staged" : "Not staged").font(.caption).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .task(id: reachable) {
                guard reachable else { return }
                await load()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let problem):
            ProblemView(problem: problem) { await load() }
        case .loaded(let diff):
            if let file = diff.files.first {
                DiffTextView(file: file, truncated: diff.truncated)
            } else {
                ContentUnavailableView("No changes", systemImage: "equal.circle")
            }
        }
    }

    private func load() async {
        do throws(WorkspaceProblem) {
            phase = .loaded(try await requests.diff(cwd: cwd, path: path, staged: staged))
        } catch {
            phase = .failed(error)
        }
    }
}
