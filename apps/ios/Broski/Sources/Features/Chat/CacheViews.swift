import BroskiCore
import SwiftUI

/// The header's cache segment and its separator: the warm window counting down, green, amber in
/// its last minute, then the hit rate alone in the subtitle's grey; nothing when nothing was cached.
struct CacheIndicator: View {
    let cache: CacheWindow

    var body: some View {
        TimelineView(CacheCountdown(cache)) { context in
            if let status = CacheStatus(cache, nowMs: context.date.unixMilliseconds) {
                let compact = status.compact
                HStack(spacing: Spacing.xs) {
                    Text(compact)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .foregroundStyle(status.tone.style)
                        .fixedSize()
                    Text("·")
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(status.spoken)
            }
        }
        .id(cache)
    }
}

/// Above the model list while switching would throw a warm prefix away.
struct CacheSwitchNotice: View {
    let cache: CacheWindow

    var body: some View {
        TimelineView(CacheCountdown(cache)) { context in
            if let warning = cache.switchWarning(at: context.date.unixMilliseconds) {
                Label(warning, systemImage: "clock")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .textCase(nil)
            }
        }
        .id(cache)
    }
}

extension CacheStatus.Tone {
    var style: AnyShapeStyle {
        switch self {
        case .calm: AnyShapeStyle(Palette.done)
        case .expiring: AnyShapeStyle(Palette.caution)
        case .quiet: AnyShapeStyle(.secondary)
        }
    }
}
