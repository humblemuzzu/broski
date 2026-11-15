import BroskiCore
import Foundation
import Observation
import os

/// The home screen's rows, as the core orders them, and what the person has seen, persisted
/// whenever the core says it changed.
@Observable
final class InboxModel {
    private(set) var rows: [InboxRow] = []
    /// Set by the "n agents working" accessory; the inbox then shows only that section.
    var filter: InboxState?

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
                if let seen = update.seen {
                    do throws(Keychain.Failure) {
                        try storage.saveSeenState(seen)
                    } catch {
                        Logger.core.error("the seen state was not saved: \(error.status)")
                    }
                }
            }
        }
    }

    /// The chat calls this when the person opens a session and again when they leave it.
    func markSeen(machineId: String, session: SessionRef) {
        inbox?.markSeen(machineId: machineId, session: session)
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
