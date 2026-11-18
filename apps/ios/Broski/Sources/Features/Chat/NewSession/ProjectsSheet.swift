import BroskiCore
import SwiftUI

/// Every folder this Mac's sessions ran in, by any agent, with a search; and Choose Folder… to go
/// anywhere on the Mac from home.
struct ProjectsSheet: View {
    let projects: [Project]
    let selected: String?
    let home: String?
    let requests: WorkspaceRequests
    let choose: (String) -> Void
    @State private var query = ""
    @State private var path: [String] = []
    @Environment(\.dismiss) private var dismiss

    private var shown: [Project] {
        let query = query.trimmed
        guard !query.isEmpty else { return projects }
        return projects.filter { $0.name.localizedStandardContains(query) || $0.path.localizedStandardContains(query) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Button { path = [home ?? "/"] } label: {
                        HStack {
                            Label("Choose Folder…", systemImage: "folder.badge.plus")
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                if !shown.isEmpty {
                    Section(query.trimmed.isEmpty ? "Recent" : "Projects") {
                        ForEach(shown) { project in
                            Button { pick(project.path) } label: {
                                ProjectSheetRow(project: project, home: home, isSelected: project.path == selected)
                            }
                            .tint(.primary)
                        }
                    }
                } else if !query.trimmed.isEmpty {
                    ContentUnavailableView.search(text: query.trimmed)
                        .listRowBackground(Color.clear)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search projects")
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
            }
            .navigationDestination(for: String.self) { folder in
                FolderPicker(path: folder, home: home, requests: requests, select: pick) { path = [$0] }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func pick(_ folder: String) {
        choose(folder)
        dismiss()
    }
}

private struct ProjectSheetRow: View {
    let project: Project
    let home: String?
    let isSelected: Bool

    var body: some View {
        HStack(spacing: Spacing.m) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(project.name)
                    .font(.body)
                Text(project.path.abbreviatingHome(home))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .truncationMode(.middle)
            }
            .lineLimit(1)
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.accent)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// One folder of the Mac while choosing where a session runs: the folders in it a page at a time, a
/// search for folders below it, the folders above it in the title's menu, and Select for this one.
struct FolderPicker: View {
    let home: String?
    let select: (String) -> Void
    let jump: (String) -> Void
    @State private var folder: FolderModel
    @State private var query = ""

    init(path: String, home: String?, requests: WorkspaceRequests, select: @escaping (String) -> Void, jump: @escaping (String) -> Void) {
        self.home = home
        self.select = select
        self.jump = jump
        _folder = State(initialValue: FolderModel(path: path, requests: requests))
    }

    /// A link may lead to a folder (`/tmp` does), and the listing cannot say; opening one that leads
    /// to a file says so.
    private var folders: [FileEntry] { folder.entries.filter { $0.kind == .dir || $0.kind == .symlink } }
    private var searching: Bool { !query.trimmed.isEmpty }

    var body: some View {
        content
            .navigationTitle(folder.path.lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarTitleMenu { places }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Select") { select(folder.path) }
                }
            }
            .searchable(text: $query, prompt: "Search folders in \(folder.path.lastPathComponent)")
            .task {
                guard folder.phase != .loaded else { return }
                await folder.load()
            }
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                await folder.search(query)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch folder.phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let problem):
            ProblemView(problem: problem) { await folder.load() }
        case .loaded:
            List {
                if searching {
                    matches
                } else {
                    Section {
                        ForEach(folders, id: \.name) { entry in
                            NavigationLink(value: folder.childPath(entry)) {
                                Label(entry.name, systemImage: entry.kind == .symlink ? "link" : "folder")
                            }
                        }
                        if let problem = folder.pageProblem {
                            Banner(problem: problem)
                            Button("Load More") { Task { await folder.loadMore() } }
                        } else if folder.hasMore {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .task(id: folder.entries.count) { await folder.loadMore() }
                        }
                    } header: {
                        Text(folder.path.abbreviatingHome(home))
                            .font(.footnote.monospaced())
                            .textCase(nil)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                }
            }
            .overlay {
                if !searching, folders.isEmpty, !folder.hasMore {
                    ContentUnavailableView(
                        "No folders in here", systemImage: "folder",
                        description: Text("Select starts the session in \(folder.path.lastPathComponent)."))
                }
            }
        }
    }

    @ViewBuilder
    private var matches: some View {
        if let problem = folder.searchProblem {
            Banner(problem: problem)
        }
        let found = (folder.matches ?? []).filter { $0.kind == .dir }
        ForEach(found, id: \.path) { match in
            NavigationLink(value: folder.matchPath(match)) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(match.path.lastPathComponent)
                    if match.path.contains("/") {
                        Text(match.path.parentPath)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                }
            }
        }
        if folder.matches != nil, found.isEmpty, folder.searchProblem == nil {
            ContentUnavailableView.search(text: query.trimmed)
                .listRowBackground(Color.clear)
        }
    }

    /// The folders above this one, nearest first, and home when it is not among them.
    @ViewBuilder
    private var places: some View {
        ForEach(folder.path.ancestorPaths, id: \.self) { ancestor in
            Button { jump(ancestor) } label: {
                Label(ancestor.lastPathComponent, systemImage: ancestor == home ? "house" : "folder")
            }
        }
        if let home, home != folder.path, !folder.path.ancestorPaths.contains(home) {
            Divider()
            Button { jump(home) } label: { Label("Home", systemImage: "house") }
        }
    }
}
