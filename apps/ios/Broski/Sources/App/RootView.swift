import SwiftUI

/// Welcome until a machine is paired, then the tab shell. The pairing sheet hangs here, above
/// both, so the switch from Welcome to the inbox happens under it.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pairing: PairingStart?

    var body: some View {
        Group {
            switch model.launch {
            case .starting:
                Color(uiColor: .systemBackground).ignoresSafeArea()
            case .unavailable(let problem):
                IdentityProblemView(problem: problem)
            case .ready where model.isPaired:
                AppTabs()
                    .transition(.opacity)
            case .ready:
                WelcomeView()
                    .transition(.opacity)
            }
        }
        .animation(Motion.spring(reduceMotion: reduceMotion), value: model.isPaired)
        .environment(\.startPairing, PairAction { pairing = $0 })
        .sheet(item: $pairing) { start in
            PairingSheet(start: start)
        }
        .onOpenURL { url in
            guard url.scheme == "broski", url.host() == "pair" else { return }
            pairing = .link(url.absoluteString)
        }
    }
}
