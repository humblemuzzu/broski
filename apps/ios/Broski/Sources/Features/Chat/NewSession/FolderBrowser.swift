import BroskiCore
import SwiftUI

/// Picks the folder a new session runs in: the folders the Mac shares, then their subfolders a
/// page at a time (`fs.list`), and "Use This Folder" wherever the person is.
struct FolderBrowser: View {
    let requests: WorkspaceRequests
    let roots: [String]
    let choose: (String) -> Void

    var body: some View {
        List(roots, id: \.self) { root in
            NavigationLink {
                FolderLevel(requests: requests, path: root, choose: choose)
            } label: {
                Label(root.lastPathComponent, systemImage: "folder.fill")
            }
        }
        .navigationTitle("Choose a Folder")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct FolderLevel: View {
    let requests: WorkspaceRequests
    let path: String
    let choose: (String) -> Void
    @State private var folder: FolderModel

    init(requests: WorkspaceRequests, path: String, choose: @escaping (String) -> Void) {
        self.requests = requests
        self.path = path
        self.choose = choose
        _folder = State(initialValue: FolderModel(path: path, requests: requests))
    }

    var body: some View {
        List {
            if case .failed(let problem) = folder.phase {
                Banner(problem: problem)
            }
            ForEach(folder.entries.filter { $0.kind == .dir }, id: \.name) { entry in
                NavigationLink {
                    FolderLevel(requests: requests, path: folder.childPath(entry), choose: choose)
                } label: {
                    Label(entry.name, systemImage: "folder")
                }
                .onAppear {
                    if entry == folder.entries.last { Task { await folder.loadMore() } }
                }
            }
        }
        .overlay {
            if folder.phase == .loading { ProgressView() }
        }
        .navigationTitle(path.lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaBar(edge: .bottom) {
            Button { choose(path) } label: {
                Text("Use This Folder").font(.body.weight(.semibold)).frame(maxWidth: .infinity)
            }
            .primaryActionStyle()
            .padding(.horizontal, Spacing.l)
            .padding(.bottom, Spacing.s)
        }
        .task { await folder.load() }
    }
}
