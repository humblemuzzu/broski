import BroskiCore
import Foundation
import Observation
import os

/// The home screen's rows, as the core orders them, and what the person has seen and the last known
/// rows, persisted whenever the core hands them over.
@Observable
final class InboxModel {
    private(set) var rows: [InboxRow] = [] {
        didSet { rowsVersion &+= 1 }
    }
    /// Older sessions are still to load: `loadMore` reads the next page as the person nears the end.
    private(set) var hasMore = false
    /// What the inbox narrows to; the agent, Mac and folder outlive the app.
    var filter = InboxFilter.stored() {
        didSet { if filter != oldValue { filter.store() } }
    }
    /// The newest answer given from a row.
    private(set) var lastAnswer: RowAnswer?
    /// Rows whose answer is on its way; their actions wait for it.
    private(set) var answering: Set<InboxRow.Key> = []

    @ObservationIgnored private var inbox: Inbox?
    @ObservationIgnored private var changes: Task<Void, Never>?
    @ObservationIgnored private var rowsVersion = 0
    @ObservationIgnored private var grouped: (key: GroupKey, sections: [InboxSection])?
    @ObservationIgnored private var searching: Task<Void, Never>?
    @ObservationIgnored private var loadingMore = false

    private struct GroupKey: Equatable {
        let rows: Int
        let pinned: Set<SessionTarget>
        let filter: InboxFilter
        let query: String
    }

    /// The rows in sections, grouped once for each change of the rows, the pins, the filter or the query:
    /// a body reads them more often than any of those change.
    func sections(pinned: Set<SessionTarget>, query: String = "") -> [InboxSection] {
        let key = GroupKey(rows: rowsVersion, pinned: pinned, filter: filter, query: query)
        if let grouped, grouped.key == key { return grouped.sections }
        let sections = InboxSection.group(rows, pinned: pinned, filter: filter, query: query)
        grouped = (key, sections)
        return sections
    }

    /// The next page of older sessions, one at a time; returns once its rows are in, or after a moment
    /// when there was nothing to read yet.
    func loadMore() async {
        guard let inbox, hasMore else { return }
        if loadingMore {
            try? await Task.sleep(for: .milliseconds(50))
            return
        }
        loadingMore = true
        defer { loadingMore = false }
        let before = rowsVersion
        await inbox.loadMore()
        var waited = 0
        while rowsVersion == before && waited < 20 && !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(25))
            waited += 1
        }
    }

    /// Searches every Mac's sessions as well as the rows loaded, a moment after the person stops typing.
    func search(_ query: String) {
        searching?.cancel()
        guard let inbox else { return }
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            inbox.search(query: "")
            return
        }
        searching = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            inbox.search(query: trimmed)
        }
    }

    /// The pinned sessions, which the inbox shows however far down its rows they lie.
    func keep(_ pinned: Set<SessionTarget>) {
        inbox?.keep(sessions: pinned.map { KeptSession(machineId: $0.machineId, session: $0.session) })
    }

    var workingCount: Int { rows.count { $0.state == .working } }

    /// Starts the one pull loop of the phone's inbox, which lives as long as the phone:
    /// `Inbox.nextChange` never ends.
    func start(_ inbox: Inbox, storage: PhoneStorage) {
        self.inbox = inbox
        rows = inbox.rows()
        changes = Task {
            while true {
                let update = await inbox.nextChange()
                rows = update.rows
                hasMore = update.hasMore
                if filter.state == .working && workingCount == 0 { filter.state = nil }
                persist(update, in: storage)
            }
        }
    }

    private func persist(_ update: InboxUpdate, in storage: PhoneStorage) {
        do throws(Keychain.Failure) {
            if let seen = update.seen { try storage.saveSeenState(seen) }
            if let cache = update.cache { try storage.saveInboxCache(cache) }
        } catch {
            Logger.core.error("the inbox's state was not saved: \(error.status)")
        }
    }

    /// The person tapped Approve or Deny: sends the row's own option for it. The row leaves Needs
    /// you through the pull loop once the agent goes on.
    func answer(_ row: InboxRow, _ decision: RowAnswer.Decision) async {
        guard let inbox, let pending = row.pending, let option = row.quickOption(decision),
            answering.insert(row.key).inserted
        else { return }
        defer { answering.remove(row.key) }
        do {
            let outcome = try await inbox.answer(
                machineId: row.machineId, session: row.session,
                interactionId: pending.interactionId, optionId: option.id)
            lastAnswer = RowAnswer(decision: decision, outcome: outcome)
        } catch {
            lastAnswer = RowAnswer(decision: decision, failure: error)
        }
    }

    func dismissAnswerNotice() {
        lastAnswer = nil
    }

    /// What a pull on the inbox does: every machine whose bridge is ready reloads its sessions from
    /// the first page, every machine waiting to dial dials now, and this returns once the reloads
    /// are answered. The rows arrive through the pull loop like any other change.
    func refresh() async {
        await inbox?.refresh()
        Logger.core.info("the inbox refresh was answered")
    }

    /// The chat calls this when the person opens a session and again when they leave it.
    func markSeen(machineId: String, session: SessionRef) {
        inbox?.markSeen(machineId: machineId, session: session)
    }

    /// The person marked the session unread: it is Done until they open it or mark it read.
    func markUnread(machineId: String, session: SessionRef) {
        inbox?.markUnread(machineId: machineId, session: session)
    }

    func markAllSeen() {
        inbox?.markAllSeen()
    }
}

/// One section of the inbox: the rows of one state, or the pinned rows, in the core's order (newest
/// first within each state).
struct InboxSection: Identifiable, Equatable {
    enum Kind: Hashable {
        case state(InboxState)
        case pinned
    }

    let kind: Kind
    let rows: [InboxRow]

    var id: Kind { kind }

    static let order: [InboxState] = [.needsYou, .working, .done, .idle]

    /// The rows the filter and the search admit: needs you, then the pinned rows that do not need the
    /// person, then working, done, idle; empty sections left out. A filter on a state shows that state
    /// alone, pinned rows in it. One pass, each row copied once: tens of thousands of rows group in a
    /// few milliseconds.
    static func group(
        _ rows: [InboxRow], pinned: Set<SessionTarget> = [], filter: InboxFilter = InboxFilter(), query: String = ""
    ) -> [InboxSection] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        let narrows = filter.narrowsRows || !words.isEmpty
        if let state = filter.state {
            let shown = rows.filter { $0.state == state && (!narrows || (filter.admits($0) && $0.matches(words))) }
            return shown.isEmpty ? [] : [InboxSection(kind: .state(state), rows: shown)]
        }
        var byKind: [Kind: [InboxRow]] = [:]
        for row in rows where !narrows || (filter.admits(row) && row.matches(words)) {
            let pinnedRow = row.state != .needsYou && !pinned.isEmpty && pinned.contains(row.target)
            byKind[pinnedRow ? .pinned : .state(row.state), default: []].append(row)
        }
        let kinds: [Kind] = [.state(.needsYou), .pinned] + order.dropFirst().map { .state($0) }
        return kinds.compactMap { kind in byKind[kind].map { InboxSection(kind: kind, rows: $0) } }
    }
}

extension InboxRow {
    struct Key: Hashable {
        let machineId: String
        let session: SessionRef
    }

    var key: Key { Key(machineId: machineId, session: session) }

    var target: SessionTarget { SessionTarget(machineId: machineId, session: session) }

    /// Whether its title or folder holds every word searched for.
    func matches(_ words: [String]) -> Bool {
        guard !words.isEmpty else { return true }
        let haystack = [title, cwd.map { URL(fileURLWithPath: $0).lastPathComponent }].compactMap(\.self).joined(separator: " ").lowercased()
        return words.allSatisfy(haystack.contains)
    }
}

/// What the inbox narrows to: one state (the working accessory's), one agent, one Mac, one folder.
/// The agent, Mac and folder are kept on the phone; the state is not.
struct InboxFilter: Equatable {
    var state: InboxState?
    var backend: String?
    var machineId: String?
    var folder: String?

    var isActive: Bool { state != nil || backend != nil || machineId != nil || folder != nil }

    /// An agent, a Mac or a folder is chosen: some rows may not show.
    var narrowsRows: Bool { backend != nil || machineId != nil || folder != nil }

    func admits(_ row: InboxRow) -> Bool {
        (backend.map { $0 == row.session.backend } ?? true)
            && (machineId.map { $0 == row.machineId } ?? true)
            && (folder.map { $0 == row.cwd } ?? true)
    }

    static func stored(in defaults: UserDefaults = .standard) -> InboxFilter {
        InboxFilter(
            backend: defaults.string(forKey: Preference.inboxAgent),
            machineId: defaults.string(forKey: Preference.inboxMachine),
            folder: defaults.string(forKey: Preference.inboxFolder))
    }

    func store(in defaults: UserDefaults = .standard) {
        defaults.set(backend, forKey: Preference.inboxAgent)
        defaults.set(machineId, forKey: Preference.inboxMachine)
        defaults.set(folder, forKey: Preference.inboxFolder)
    }
}
