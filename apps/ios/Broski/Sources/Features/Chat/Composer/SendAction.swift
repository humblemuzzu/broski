import BroskiCore

/// The composer's one button, its face from one rule: idle, Send; running with something typed,
/// Steer, as Enter does in the agent's own terminal, or Queue when the backend takes no steering,
/// with the other offered on a long press; running with nothing typed, a red Stop.
enum SendAction: Equatable {
    case send
    case queue
    case steer
    case stop
    /// A run is live and the backend takes no message until it ends.
    case wait

    /// - Parameter modes: the backend's `promptModes`.
    static func resolve(running: Bool, hasContent: Bool, modes: [PromptMode]) -> SendAction {
        guard running else { return .send }
        guard hasContent else { return .stop }
        if modes.contains(.steer) { return .steer }
        if modes.contains(.queue) { return .queue }
        return .wait
    }

    /// The other way to send while running, for the long press; `nil` when there is none.
    static func alternative(to action: SendAction, modes: [PromptMode]) -> SendAction? {
        guard modes.contains(.queue), modes.contains(.steer) else { return nil }
        return switch action {
        case .queue: .steer
        case .steer: .queue
        default: nil
        }
    }

    var mode: PromptMode? {
        switch self {
        case .send: .start
        case .queue: .queue
        case .steer: .steer
        case .stop, .wait: nil
        }
    }

    var title: String {
        switch self {
        case .send: "Send"
        case .queue: "Queue"
        case .steer: "Steer"
        case .stop: "Stop"
        case .wait: "Send"
        }
    }

    /// What the long press says of each way.
    var explanation: String {
        switch self {
        case .queue: "Waits until the agent finishes"
        case .steer: "Joins the run at the agent's next step"
        case .send: "Start a run"
        case .stop: "Stop the run"
        case .wait: "Waits until the run ends"
        }
    }

    /// What the field invites while a run is live; `nil` when a message cannot be sent before it ends.
    var invitation: String? {
        switch self {
        case .steer: "Steer the agent"
        case .queue: "Queue a message"
        case .send, .stop, .wait: nil
        }
    }

    var symbol: String {
        switch self {
        case .send, .queue, .wait: "arrow.up"
        case .steer: "arrow.turn.left.up"
        case .stop: "stop.fill"
        }
    }
}
