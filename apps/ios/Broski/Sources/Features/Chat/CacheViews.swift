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
                        .lineLimit(1)
                    Text("·")
                }
                .layoutPriority(1)
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

/// Keeps `cacheReadAtMs` for the views under it: the moment `cache` arrived, then once more the
/// moment it expires, one wake rather than a ticking clock, so what a menu draws from it stops
/// promising a window that has closed.
private struct CacheExpiryClock: ViewModifier {
    let expiresAtMs: Int64?
    @State private var nowMs = Date.now.unixMilliseconds

    func body(content: Content) -> some View {
        content
            .environment(\.cacheReadAtMs, nowMs)
            .task(id: expiresAtMs) {
                nowMs = Date.now.unixMilliseconds
                while let expiresAtMs, nowMs < expiresAtMs {
                    try? await Task.sleep(for: .milliseconds(expiresAtMs - nowMs))
                    guard !Task.isCancelled else { return }
                    nowMs = Date.now.unixMilliseconds
                }
            }
    }
}

extension View {
    func cacheExpiryClock(_ cache: CacheWindow?) -> some View {
        modifier(CacheExpiryClock(expiresAtMs: cache?.expiresAtMs))
    }
}

extension EnvironmentValues {
    /// When the chat last read its prompt cache's window; `nil` outside a chat, where it is read now.
    @Entry var cacheReadAtMs: Int64?
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
