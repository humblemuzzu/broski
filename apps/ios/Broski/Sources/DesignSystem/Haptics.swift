import SwiftUI

/// The moments that get a haptic, and the feedback each gets (design.md, "Haptics"). Never one per
/// streamed chunk; `sensoryFeedback` already honours the system's haptics setting.
enum HapticMoment: Equatable {
    /// An approval or an answer was sent; also a pairing that succeeded.
    case confirmed
    /// Deny, delete, forget.
    case destructive
    /// A send failed or a link was lost.
    case failed
    /// A work row expanded or collapsed.
    case toggled(expanded: Bool)
    case sent
    case stopped
    /// The microphone started recording a dictation.
    case listening
    /// One step in a picker (model, thinking).
    case pickerStep
    case snappedToLatest

    var feedback: SensoryFeedback {
        switch self {
        case .confirmed: .success
        case .destructive: .warning
        case .failed: .error
        case .toggled(let expanded): .selection(expanded ? .on : .off)
        case .sent: .impact(weight: .light)
        case .stopped: .stop
        case .listening: .start
        case .pickerStep: .selection
        case .snappedToLatest: .alignment
        }
    }
}

extension View {
    /// Plays `moment` each time `trigger` changes.
    func haptic<T: Equatable>(_ moment: HapticMoment, trigger: T) -> some View {
        sensoryFeedback(moment.feedback, trigger: trigger)
    }

    /// Plays `moment` when `trigger` changes and `condition` holds for the change.
    func haptic<T: Equatable>(
        _ moment: HapticMoment, trigger: T, when condition: @escaping (_ old: T, _ new: T) -> Bool
    ) -> some View {
        sensoryFeedback(moment.feedback, trigger: trigger, condition: condition)
    }
}
