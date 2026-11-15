import SwiftUI

/// Short, physical, interruptible motion. With Reduce Motion on, movement becomes a crossfade.
enum Motion {
    /// Sheets, cards and state changes that spring in.
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.84)
    /// Small, quick changes: chips, badges, toggled rows.
    static let snappy = Animation.snappy(duration: 0.28)
    static let crossfade = Animation.easeInOut(duration: 0.2)

    static func spring(reduceMotion: Bool) -> Animation {
        reduceMotion ? crossfade : spring
    }

    static func snappy(reduceMotion: Bool) -> Animation {
        reduceMotion ? crossfade : snappy
    }
}

extension AnyTransition {
    /// Rows and cards arrive with a fade and a short rise.
    static let rise = AnyTransition.opacity.combined(with: .offset(y: 12))

    static func rise(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : rise
    }
}

extension View {
    /// `animation(_:value:)` with the spring, or a crossfade under Reduce Motion.
    func springAnimation<V: Equatable>(value: V) -> some View {
        modifier(SpringAnimation(value: value))
    }
}

private struct SpringAnimation<V: Equatable>: ViewModifier {
    let value: V
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(Motion.spring(reduceMotion: reduceMotion), value: value)
    }
}
