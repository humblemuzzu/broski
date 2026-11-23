import BroskiCore
import Foundation

/// How a tool permission's options lay out and what each sends (contract §9): the backend's options
/// in its order, the plain allow-once as the one prominent button, a deny that may carry words for
/// the agent beside the field that takes them, and the grants an allow must choose from.
struct PermissionAnswer: Equatable {
    let request: ToolPermissionRequest

    /// Allowing for this call only, with nothing to say and no run ended: the one-tap answer.
    var primary: PermissionOption? {
        request.options.first { $0.effect == .allow && $0.scope == .once && $0.message == .none && !$0.stopsRun }
    }

    /// The deny that sends "what to do instead": the first that lets the run go on and takes words.
    var denyWithMessage: PermissionOption? {
        request.options.first { $0.effect == .deny && !$0.stopsRun && $0.message != .none }
    }

    /// Every allow but the primary, in the backend's order: wider scopes beside it.
    var otherAllows: [PermissionOption] {
        request.options.filter { $0.effect == .allow && $0.id != primary?.id }
    }

    /// Every deny but the one beside the field, in the backend's order.
    var otherDenies: [PermissionOption] {
        request.options.filter { $0.effect == .deny && $0.id != denyWithMessage?.id }
    }

    /// The Deny beside Allow: the deny that lets the run go on, else the first deny.
    var plainDeny: PermissionOption? {
        request.options.first { $0.effect == .deny && !$0.stopsRun } ?? request.options.first { $0.effect == .deny }
    }

    /// The denies kept in the card's menu: every one but the Deny beside Allow (Deny and Stop).
    var menuDenies: [PermissionOption] {
        request.options.filter { $0.effect == .deny && $0.id != plainDeny?.id }
    }

    /// Whether `option` can go now: words it requires are typed, and an allow chooses a grant
    /// when grants were asked for.
    func canSend(_ option: PermissionOption, message: String, grants: Set<String>) -> Bool {
        if option.message == .required && message.trimmed.isEmpty { return false }
        if option.effect == .allow && !request.grants.isEmpty && grants.isEmpty { return false }
        return true
    }

    /// Exactly what the person chose: the option, their words when the option takes words, and the
    /// grants only when allowing.
    func reply(_ option: PermissionOption, message: String, grants: Set<String>) -> InteractionReply {
        let words = message.trimmed
        return .toolPermission(
            ToolPermissionReply(
                optionId: option.id,
                message: option.message == .none || words.isEmpty ? nil : words,
                editedInput: nil,
                grantIds: option.effect == .allow ? request.grants.map(\.id).filter(grants.contains) : []))
    }
}
