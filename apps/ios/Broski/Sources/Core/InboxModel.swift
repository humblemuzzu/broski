import BroskiCore
import Foundation
import Observation
import os

/// The home screen's rows, as the core orders them, and what the person has seen and the last known
/// rows, persisted whenever the core hands them over.
@Observable
final class InboxModel {
    private(set) var rows: [InboxRow] = []
    /// Set by the "n agents working" accessory; the inbox then shows only that section.
    var filter: InboxState?
    /// The newest answer given from a row.
    private(set) var lastAnswer: RowAnswer?
    /// Rows whose answer is on its way; their actions wait for it.
    private(set) var answering: Set<InboxRow.Key> = []

    @ObservationIgnored private var inbox: Inbox?
    @ObservationIgnored private var changes: Task<Void, Never>?

    var sections: [InboxSection] { InboxSection.group(rows, showing: filter) }

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

    func markAllSeen() {
        inbox?.markAllSeen()
    }
}

/// One section of the inbox: the rows of one state, in the core's order (newest first).
struct InboxSection: Identifiable, Equatable {
    let state: InboxState
    let rows: [InboxRow]

    var id: InboxState { state }

    static let order: [InboxState] = [.needsYou, .working, .done, .idle]

    /// Needs you, working, done, idle; empty sections left out.
    static func group(_ rows: [InboxRow], showing filter: InboxState? = nil) -> [InboxSection] {
        let byState = Dictionary(grouping: rows, by: \.state)
        return order.compactMap { state in
            guard filter == nil || filter == state, let rows = byState[state] else { return nil }
            return InboxSection(state: state, rows: rows)
        }
    }
}

extension InboxRow {
    struct Key: Hashable {
        let machineId: String
        let session: SessionRef
    }

    var key: Key { Key(machineId: machineId, session: session) }
}
