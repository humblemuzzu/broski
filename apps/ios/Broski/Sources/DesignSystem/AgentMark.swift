import BroskiCore
import SwiftUI

/// The agent's logo in its tile. Scales with Dynamic Type up to a size that leaves the text beside
/// it room; VoiceOver reads the agent's name.
struct AgentMark: View {
    let backend: BackendId
    @ScaledMetric(relativeTo: .body) private var scaledSide: CGFloat = 36

    private var side: CGFloat { min(scaledSide, 56) }

    var body: some View {
        AgentLogo(brand: backend.brand, side: side)
    }
}
