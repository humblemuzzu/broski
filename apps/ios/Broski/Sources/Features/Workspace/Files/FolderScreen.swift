import BroskiCore
import SwiftUI
import UIKit

/// One folder: the repository it is in and the terminals opened in it, then its entries a page at
/// a time, search by name under it, and a terminal opened here.
struct FolderScreen: View {
    let machineId: String
    @State private var model: FolderModel
    @State private var repository: RepositoryModel
    @State private var terminals: FolderTerminals
    @State private var closing: TerminalSummary?
    @State private var query = ""
    @Environment(\.workspaceReachable) private var reachable

    init(machineId: String, path: String, requests: WorkspaceRequests) {
        self.machineId = machineId
        _model = State(initialValue: FolderModel(path: path, requests: requests))
        _repository = State(initialValue: RepositoryModel(cwd: path, requests: requests))
        _terminals = State(initialValue: FolderTerminals(folder: path, requests: requests))
    }

    var body: some View {
        content
            .navigationTitle(model.path.lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search names in \(model.path.lastPathComponent)")
            .toolbar { toolbar }
            .task(id: reachable) {
                guard reachable, model.phase != .loaded else { return }
                async let listed: Void = model.load()
                async let checked: Void = repository.check()
                _ = await (listed, checked)
            }
            // Each time the folder shows again: the person may come back from a terminal opened here.
            .task(id: TerminalsKey(reachable: reachable, canonical: model.canonicalPath)) {
                guard reachable else { return }
                terminals.canonicalFolder = model.canonicalPath
                await terminals.load()
            }
            .confirmationDialog(
                "Close this terminal?", isPresented: Binding { closing != nil } set: { if !$0 { closing = nil } },
                titleVisibility: .visible, presenting: closing
            ) { terminal in
                Button("Close Terminal", role: .destructive) { Task { await terminals.close(terminal) } }
            } message: { _ in
                Text("What runs in it ends.")
            }
            .haptic(.destructive, trigger: terminals.terminals.count) { $1 < $0 }
            .task(id: query) {
                guard reachable else { return }
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                await model.search(query)
            }
            .onChange(of: model.showsHidden) {
                Task { await model.load() }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .loaded:
            if let matches = model.matches, !query.isEmpty {
                SearchResults(machineId: machineId, model: model, matches: matches)
            } else {
                entries
            }
        }
    }

    private var entries: some View {
        List {
            if let status = repository.status {
                Section {
                    NavigationLink(value: Route.workspace(machineId: machineId, place: .git(cwd: model.path))) {
                        RepositoryRow(status: status)
                    }
                }
            }
            FolderTerminalsSection(machineId: machineId, model: terminals, closing: $closing)
            Section {
                if model.entries.isEmpty, !model.hasMore, !isBare {
                    Text("Nothing in this folder")
                        .foregroundStyle(.secondary)
                }
                ForEach(model.entries, id: \.name) { entry in
                    EntryLink(machineId: machineId, entry: entry, path: model.childPath(entry))
                }
                if let problem = model.pageProblem {
                    Banner(problem: problem)
                    Button("Load More") { Task { await model.loadMore() } }
                } else if model.hasMore {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .task { await model.loadMore() }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.entries.isEmpty, isBare {
                ContentUnavailableView("Empty folder", systemImage: "folder")
            }
        }
        .refreshable {
            async let listed: Void = model.load()
            async let checked: Void = repository.check()
            async let opened: Void = terminals.load()
            _ = await (listed, checked, opened)
        }
    }

    /// Nothing above the entries either, so an empty folder can say so over the whole screen.
    private var isBare: Bool { repository.status == nil && terminals.terminals.isEmpty }

    private struct TerminalsKey: Equatable {
        let reachable: Bool
        let canonical: String?
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                NavigationLink(value: Route.workspace(machineId: machineId, place: .newTerminal(cwd: model.path))) {
                    Label("Open Terminal Here", systemImage: "apple.terminal")
                }
                .disabled(!reachable)
                Toggle("Show Hidden Files", systemImage: "eye", isOn: $model.showsHidden)
                Button("Copy Path", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = model.path
                }
            } label: {
                Label("More", systemImage: "ellipsis")
            }
        }
    }
}

private struct SearchResults: View {
    let machineId: String
    let model: FolderModel
    let matches: [FileMatch]

    var body: some View {
        List {
            if let problem = model.searchProblem {
                Banner(problem: problem)
            }
            ForEach(matches, id: \.path) { match in
                let entry = FileEntry(name: match.path, kind: match.kind, size: nil, modifiedAt: nil)
                EntryLink(machineId: machineId, entry: entry, path: model.matchPath(match))
            }
        }
        .listStyle(.plain)
        .overlay {
            if matches.isEmpty {
                ContentUnavailableView.search
            }
        }
    }
}
