import SwiftUI
import ThinkingOrbsKit

/// The one sign that something is under way: a thinking orb (ThinkingOrbsKit) sized with the text
/// beside it, hidden from VoiceOver because that text says what is under way. Under 40 pt it draws
/// the library's 20 pt design, above it the 64 pt one. It rests on one still frame when `still`,
/// outside an active scene and under Reduce Motion, as the shimmer does.
struct Orb: View {
    let state: OrbState
    let theme: OrbTheme
    let still: Bool
    @ScaledMetric private var side: CGFloat
    @Environment(\.scenePhase) private var scenePhase

    init(
        _ state: OrbState, side: CGFloat = 20, relativeTo style: Font.TextStyle = .body, theme: OrbTheme = .auto,
        still: Bool = false
    ) {
        self.state = state
        self.theme = theme
        self.still = still
        _side = ScaledMetric(wrappedValue: side, relativeTo: style)
    }

    var body: some View {
        ThinkingOrb(
            state: state, size: side < 40 ? .px20 : .px64, theme: theme,
            paused: still || scenePhase != .active, displaySize: side)
            .accessibilityHidden(true)
    }
}

/// Waiting on the Mac in place of a spinner, with no words beside it: an orb VoiceOver reads as
/// `label`.
struct LoadingOrb: View {
    var state: OrbState = .searching
    var side: CGFloat = 20
    var theme: OrbTheme = .auto
    var label = "Loading"

    var body: some View {
        // The stack is no element of its own, so this makes a new one rather than relabelling the
        // orb's hidden one.
        ZStack { Orb(state, side: side, theme: theme) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityAddTraits(.updatesFrequently)
    }
}
