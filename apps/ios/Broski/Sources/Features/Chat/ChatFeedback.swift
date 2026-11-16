import BroskiCore
import Foundation

/// A moment the chat plays a haptic for; a new value each time, so the same moment twice plays twice.
struct ChatFeedback: Equatable {
    let id = UUID()
    let moment: HapticMoment

    init(_ moment: HapticMoment) {
        self.moment = moment
    }
}

extension Interaction {
    /// A denial or a dismissal, which plays the warning haptic rather than the success one.
    func isRefusal(_ reply: InteractionReply) -> Bool {
        switch (reply, request) {
        case (.cancel, _): true
        case (.confirm(let reply), _): !reply.confirmed
        case (.planApproval(let reply), _): reply.decision == .reject
        case (.toolPermission(let reply), .toolPermission(let request)):
            request.options.first { $0.id == reply.optionId }?.effect == .deny
        default: false
        }
    }
}
