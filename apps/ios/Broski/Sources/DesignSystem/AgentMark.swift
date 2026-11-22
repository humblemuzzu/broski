import BroskiCore
import SwiftUI

/// The agent's mark in its tile. Scales with Dynamic Type up to a size that leaves the text beside
/// it room; VoiceOver reads the agent's name.
struct AgentMark: View {
    let brand: AgentBrand
    @ScaledMetric(relativeTo: .body) private var scaledSide: CGFloat = 36

    private var side: CGFloat { min(scaledSide, 56) }

    var body: some View {
        AgentLogo(brand: brand, side: side)
    }
}

extension AgentBrand {
    /// The descriptor's `iconHint` picks the logo when it gives one; only `claude` and `pi` have
    /// theirs, every other hint draws the monogram.
    init(_ descriptor: BackendDescriptor) {
        let logo: Logo? = switch descriptor.iconHint {
        case .claude: .claude
        case .pi: .pi
        case nil: Logo(backend: descriptor.id)
        default: nil
        }
        self.init(backend: descriptor.id, name: descriptor.displayName, accentHex: descriptor.accentHex, logo: logo)
    }
}
