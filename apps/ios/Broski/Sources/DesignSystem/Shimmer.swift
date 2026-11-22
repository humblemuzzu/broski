import SwiftUI

extension View {
    /// The one "alive" signal: a band of brighter ink that sweeps the text, then rests (1.35 s
    /// sweep and 1.45 s pause, 72 pt wide). It runs only while `active`, on screen, in an
    /// active scene, and never under Reduce Motion; otherwise the text simply shows in `base`.
    func shimmer(_ active: Bool, base: Color = .secondary) -> some View {
        modifier(Shimmer(active: active, base: base))
    }
}

private struct Shimmer: ViewModifier {
    let active: Bool
    let base: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var onScreen = true

    private nonisolated static let band: CGFloat = 72

    private var running: Bool { active && onScreen && scenePhase == .active && !reduceMotion }

    func body(content: Content) -> some View {
        content
            .foregroundStyle(base)
            .overlay {
                if running {
                    content
                        .foregroundStyle(.primary)
                        .accessibilityHidden(true)
                        .keyframeAnimator(initialValue: CGFloat(0), repeating: true) { highlighted, progress in
                            highlighted.mask { Self.sweep(progress) }
                        } keyframes: { _ in
                            LinearKeyframe(1, duration: 1.35)
                            LinearKeyframe(1, duration: 1.45)
                        }
                }
            }
            .onScrollVisibilityChange(threshold: 0.01) { onScreen = $0 }
    }

    private nonisolated static func sweep(_ progress: CGFloat) -> some View {
        LinearGradient(colors: [.clear, .white, .clear], startPoint: .leading, endPoint: .trailing)
            .frame(width: band)
            .frame(maxWidth: .infinity, alignment: .leading)
            .visualEffect { content, proxy in
                content.offset(x: progress * (proxy.size.width + band) - band)
            }
    }
}
