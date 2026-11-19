import BroskiCore
import SwiftUI

/// A repository: its branch, staged / changed / untracked files (swipe or menu to stage and
/// unstage, tap for the diff), the newest commits, and a commit field.
struct GitScreen: View {
    let machineId: String
    @State private var model: GitModel
    @Environment(\.workspaceReachable) private var reachable
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(machineId: String, cwd: String, requests: WorkspaceRequests) {
        self.machineId = machineId
        _model = State(initialValue: GitModel(cwd: cwd, requests: requests))
    }

    var body: some View {
        content
            .navigationTitle("Git")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: reachable) {
                guard reachable else { return }
                await model.load()
            }
            .haptic(.confirmed, trigger: model.commitCount)
            .haptic(.failed, trigger: model.problem) { $1 != nil }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            LoadingOrb(side: 64).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .notRepository:
            ContentUnavailableView(
                "Not a git repository", systemImage: "arrow.triangle.branch",
                description: Text("\(model.cwd.lastPathComponent) isn't inside a repository."))
        case .failed(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .loaded(let status):
            list(status)
                .safeAreaInset(edge: .bottom) {
                    CommitBar(model: model)
                        .padding(.horizontal, Spacing.l)
                        .padding(.bottom, Spacing.s)
                }
        }
    }

    private func list(_ status: GitStatusRead) -> some View {
        List {
            Section {
                NavigationLink(value: Route.workspace(machineId: machineId, place: .branches(cwd: model.cwd))) {
                    BranchRow(status: status)
                }
                if let problem = model.problem {
                    Banner(problem: problem)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }
            ForEach(model.sections) { section in
                Section {
                    ForEach(section.rows) { row in
                        changeLink(row, root: status.root)
                    }
                } header: {
                    GitSectionHeader(section: section, model: model)
                }
            }
            if model.sections.isEmpty {
                Section {
                    Label("Nothing to commit, working tree clean", systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                }
            }
            if status.truncated {
                Text("Git listed more changes than Broski shows.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !model.commits.isEmpty {
                Section("Recent Commits") {
                    ForEach(model.commits, id: \.hash) { CommitRow(commit: $0) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.load() }
        .animation(Motion.snappy(reduceMotion: reduceMotion), value: model.sections)
    }

    private func changeLink(_ row: GitRow, root: String) -> some View {
        let place: WorkspacePlace =
            row.area == .untracked
            ? .file((root as NSString).appendingPathComponent(row.path))
            : .diff(cwd: model.cwd, path: row.path, staged: row.area == .staged)
        return NavigationLink(value: Route.workspace(machineId: machineId, place: place)) {
            GitRowView(row: row)
        }
        .swipeActions(edge: .trailing) { stageButton(row) }
        .contextMenu { stageButton(row) }
    }

    @ViewBuilder
    private func stageButton(_ row: GitRow) -> some View {
        if row.area == .staged {
            Button("Unstage", systemImage: "minus.circle") { Task { await model.unstage([row.path]) } }
                .tint(Palette.caution)
                .disabled(!reachable || model.isChanging)
        } else {
            Button("Stage", systemImage: "plus.circle") { Task { await model.stage([row.path]) } }
                .tint(Palette.done)
                .disabled(!reachable || model.isChanging)
        }
    }
}

private struct GitSectionHeader: View {
    let section: GitSection
    let model: GitModel
    @Environment(\.workspaceReachable) private var reachable

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                title
                Spacer()
                action
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                title
                action
            }
        }
    }

    private var title: some View {
        HStack {
            Text(section.area.rawValue)
            Text(section.rows.count, format: .number).foregroundStyle(.secondary)
        }
        .fixedSize()
    }

    private var action: some View {
        Button(section.area == .staged ? "Unstage All" : "Stage All") {
            Task {
                if section.area == .staged {
                    await model.unstage(["."])
                } else {
                    await model.stage(section.rows.prefix(1000).map(\.path))
                }
            }
        }
        .font(.subheadline)
        .textCase(nil)
        .fixedSize()
        .disabled(!reachable || model.isChanging)
    }
}

/// The branch, or the commit a detached HEAD sits on, and how far it is from its upstream.
private struct BranchRow: View {
    let status: GitStatusRead

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(status.branch ?? "Detached at \(status.head.map { String($0.prefix(7)) } ?? "no commit")")
                    .font(.body.weight(.semibold))
                if let upstream = status.upstream {
                    Text(upstream.summary)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        } icon: {
            Image(systemName: "arrow.triangle.branch")
        }
    }
}

private struct CommitRow: View {
    let commit: GitCommit

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            Text(commit.subject).font(.subheadline).lineLimit(2)
            HStack(spacing: Spacing.s) {
                Text(commit.hash.prefix(7)).font(.codeSmall)
                Text(commit.author)
                RelativeTime(date: Date(unixMilliseconds: commit.authoredAt))
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

extension GitUpstream {
    /// "2 ahead, 1 behind origin/main", or "Up to date with origin/main".
    var summary: String {
        var parts: [String] = []
        if ahead > 0 { parts.append("\(ahead) ahead") }
        if behind > 0 { parts.append("\(behind) behind") }
        return parts.isEmpty ? "Up to date with \(name)" : "\(parts.joined(separator: ", ")) \(name)"
    }
}
