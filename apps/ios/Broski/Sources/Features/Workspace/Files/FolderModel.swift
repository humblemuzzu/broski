import BroskiCore
import Foundation
import Observation

/// One directory on a machine, a page at a time in the bridge's order (directories first, then by
/// name), and the files under it whose names match a search.
@Observable
final class FolderModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case failed(WorkspaceProblem)
    }

    let path: String
    private(set) var phase: Phase = .loading
    private(set) var entries: [FileEntry] = []
    private(set) var nextCursor: String?
    private(set) var isLoadingMore = false
    /// The last page that did not come, said under the list; the next scroll tries again.
    private(set) var pageProblem: WorkspaceProblem?
    var showsHidden = false
    private(set) var matches: [FileMatch]?
    private(set) var searchProblem: WorkspaceProblem?

    @ObservationIgnored private let requests: WorkspaceRequests

    init(path: String, requests: WorkspaceRequests) {
        self.path = path
        self.requests = requests
    }

    var hasMore: Bool { nextCursor != nil }

    /// The first page again, replacing everything listed.
    func load() async {
        do throws(WorkspaceProblem) {
            let page = try await requests.list(path: path, cursor: nil, hidden: showsHidden)
            entries = page.entries
            nextCursor = page.nextCursor
            pageProblem = nil
            phase = .loaded
        } catch {
            phase = .failed(error)
        }
    }

    /// The page after the last entry; a call while one is on its way, or after the last page, does
    /// nothing.
    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do throws(WorkspaceProblem) {
            let page = try await requests.list(path: path, cursor: cursor, hidden: showsHidden)
            entries += page.entries
            nextCursor = page.nextCursor
            pageProblem = nil
        } catch {
            pageProblem = error
        }
    }

    /// Files and folders under this one whose names match `query`, best match first; an empty
    /// query ends the search.
    func search(_ query: String) async {
        let query = query.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else {
            matches = nil
            searchProblem = nil
            return
        }
        do throws(WorkspaceProblem) {
            let found = try await requests.search(root: path, query: String(query.prefix(256)))
            matches = found.matches
            searchProblem = nil
        } catch {
            searchProblem = error
        }
    }

    func childPath(_ entry: FileEntry) -> String {
        (path as NSString).appendingPathComponent(entry.name)
    }

    /// A match's path is relative to this folder.
    func matchPath(_ match: FileMatch) -> String {
        (path as NSString).appendingPathComponent(match.path)
    }
}
