import BroskiCore
import SwiftUI

/// The agent's monogram in a neutral tile: "CC" for Claude Code, "Pi" for Pi. Scales with
/// Dynamic Type up to a size that leaves the text beside it room; VoiceOver reads the agent's name.
struct AgentMark: View {
    let backend: BackendId
    @ScaledMetric(relativeTo: .body) private var scaledSide: CGFloat = 36

    private var side: CGFloat { min(scaledSide, 56) }

    var body: some View {
        Text(backend.monogram)
            .font(.system(size: side * 0.4, weight: .bold, design: .rounded))
            .foregroundStyle(Palette.markInk)
            .frame(width: side, height: side)
            .background(Palette.markFill, in: .rect(cornerRadius: side * 0.3, style: .continuous))
            .accessibilityElement()
            .accessibilityLabel(backend.displayName)
    }
}
