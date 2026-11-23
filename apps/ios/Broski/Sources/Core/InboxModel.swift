import BroskiCore
import Foundation
import Observation
import os

/// The home screen's rows, as the core orders them, and what the person has seen and the last known
/// rows, persisted whenever the core hands them over.
@Observable
final class InboxModel {
    private(set) var rows: [InboxRow] = []
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

    func sections(pinned: Set<SessionTarget>, query: String = "") -> [InboxSection] {
        InboxSection.group(rows, pinned: pinned, filter: filter, query: query)
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
    /// alone, pinned rows in it.
    static func group(
        _ rows: [InboxRow], pinned: Set<SessionTarget> = [], filter: InboxFilter = InboxFilter(), query: String = ""
    ) -> [InboxSection] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        let rows = rows.filter { filter.admits($0) && $0.matches(words) }
        if let state = filter.state {
            let shown = rows.filter { $0.state == state }
            return shown.isEmpty ? [] : [InboxSection(kind: .state(state), rows: shown)]
        }
        let isPinned = { (row: InboxRow) in row.state != .needsYou && pinned.contains(row.target) }
        let byState = Dictionary(grouping: rows.filter { !isPinned($0) }, by: \.state)
        let sections = order.compactMap { state in
            byState[state].map { InboxSection(kind: .state(state), rows: $0) }
        }
        let pinnedRows = rows.filter(isPinned)
        let pinnedSection = pinnedRows.isEmpty ? [] : [InboxSection(kind: .pinned, rows: pinnedRows)]
        let urgent = sections.prefix { $0.kind == .state(.needsYou) }
        return Array(urgent) + pinnedSection + sections.dropFirst(urgent.count)
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
