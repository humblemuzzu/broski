import BroskiCore

/// The composer's one button, its face from one rule (design.md, "Composer"): idle, Send; running
/// with something typed, Queue by default or Steer, with the other offered on a long press; running
/// with nothing typed, a red Stop.
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
        if modes.contains(.queue) { return .queue }
        if modes.contains(.steer) { return .steer }
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
        case .queue: "Run after the current turn"
        case .steer: "Interrupt what the agent is doing"
        case .send: "Start a run"
        case .stop: "Stop the run"
        case .wait: "Waits until the run ends"
        }
    }

    var symbol: String {
        switch self {
        case .send, .wait: "arrow.up"
        case .queue: "text.line.last.and.arrowtriangle.forward"
        case .steer: "arrow.turn.left.up"
        case .stop: "stop.fill"
        }
    }
}
