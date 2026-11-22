import BroskiCore
import Foundation

/// The person tapped Approve or Deny on an inbox row, and what came of it.
struct RowAnswer: Equatable, Identifiable {
    enum Decision: Equatable {
        case approve
        case deny
    }

    enum Outcome: Equatable {
        case sent
        /// Another phone, the terminal or the agent itself got there first.
        case stale
        case failed(String)
    }

    let id = UUID()
    let decision: Decision
    let outcome: Outcome

    var haptic: HapticMoment {
        switch (outcome, decision) {
        case (.sent, .approve): .confirmed
        case (.sent, .deny), (.stale, _): .destructive
        case (.failed, _): .failed
        }
    }

    /// What the inbox says about it; nothing when it went through, since the row moves on.
    var notice: String? {
        switch outcome {
        case .sent: nil
        case .stale: "Already answered elsewhere."
        case .failed(let why): "Couldn't send the answer. \(why)"
        }
    }

    init(decision: Decision, outcome: AnswerOutcome) {
        self.decision = decision
        switch outcome {
        case .accepted: self.outcome = .sent
        case .stale: self.outcome = .stale
        case .rejected(_, let detail): self.outcome = .failed(detail)
        }
    }

    init(decision: Decision, failure: Error) {
        self.decision = decision
        outcome = .failed(String(describing: failure))
    }
}

extension InboxRow {
    /// The backend's own option a tap may choose for this row: present only for a tool permission
    /// the inbox sees live, whose options allow a one-tap answer.
    func quickOption(_ decision: RowAnswer.Decision) -> PermissionOption? {
        switch decision {
        case .approve: pending?.allow
        case .deny: pending?.deny
        }
    }

    /// "Claude Code wants to run npm test", or the agent's own words for any other ask.
    func askLine(agent: String) -> String? {
        guard state == .needsYou else { return nil }
        if let command { return "\(agent) wants to run \(command)" }
        return ask
    }
}
