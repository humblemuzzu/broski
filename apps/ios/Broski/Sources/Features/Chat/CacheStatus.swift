import BroskiCore
import Foundation
import SwiftUI

/// What the prompt cache says at a moment. The bridge sends the window once per request, never a
/// countdown, so the phone counts: warm while the lifetime the backend published lasts, then only
/// how much of the last prompt the cache served (open-source-blueprint.md §3.4). No lifetime, no
/// timer.
nonisolated enum CacheStatus: Equatable {
    case warm(remainingMs: Int64, estimated: Bool, hitPercent: Int?)
    case hitOnly(hitPercent: Int)

    enum Tone { case calm, expiring, quiet }

    static let expiringMs: Int64 = 60_000

    init?(_ cache: CacheWindow?, nowMs: Int64) {
        guard let cache else { return nil }
        if let remaining = cache.remainingMs(at: nowMs), remaining > 0 {
            self = .warm(remainingMs: remaining, estimated: cache.confidence == .estimated, hitPercent: cache.hitPercent)
        } else if let hit = cache.hitPercent, (cache.cachedTokens ?? 0) > 0 {
            self = .hitOnly(hitPercent: hit)
        } else {
            return nil
        }
    }

    var tone: Tone {
        switch self {
        case .warm(let remaining, _, _): remaining > Self.expiringMs ? .calm : .expiring
        case .hitOnly: .quiet
        }
    }

    /// "Cache 3m 42s · 94%", "Cache ~3m", "91% cached".
    var compact: String {
        switch self {
        case .warm(let remaining, let estimated, let hit):
            "Cache " + CacheFormat.duration(ms: remaining, estimated: estimated) + (hit.map { " · \($0)%" } ?? "")
        case .hitOnly(let hit):
            "\(hit)% cached"
        }
    }

    var spoken: String {
        switch self {
        case .warm(let remaining, let estimated, let hit):
            let left = (estimated ? "about " : "") + CacheFormat.span(ms: remaining, coarse: estimated)
            return "Prompt cache warm, \(left) left" + (hit.map { ", \($0)% cached" } ?? "")
        case .hitOnly(let hit):
            return "\(hit)% of the prompt cached"
        }
    }
}

nonisolated extension CacheWindow {
    static let switchWarningTokens: Int64 = 20_000

    var expiresAtMs: Int64? { ttlMs.map { lastTouchAt + $0 } }

    /// Never more than the lifetime, so a phone clock behind the Mac's does not stretch it.
    func remainingMs(at nowMs: Int64) -> Int64? {
        guard let ttlMs, let expiresAtMs else { return nil }
        return min(ttlMs, max(0, expiresAtMs - nowMs))
    }

    var hitPercent: Int? {
        guard let cachedTokens, let promptTokens, promptTokens > 0 else { return nil }
        return min(100, max(0, Int((Double(cachedTokens) / Double(promptTokens) * 100).rounded())))
    }

    /// Enough is cached, under a lifetime, that a model switch would start a costly prefix over.
    var warnsOnModelSwitch: Bool { ttlMs != nil && (cachedTokens ?? 0) >= Self.switchWarningTokens }

    func shouldWarnOnModelSwitch(at nowMs: Int64) -> Bool {
        warnsOnModelSwitch && (remainingMs(at: nowMs) ?? 0) > 0
    }

    /// "Cache warm (142k tokens, 3m 42s left) — switching models will re-cache".
    func switchWarning(at nowMs: Int64) -> String? {
        guard shouldWarnOnModelSwitch(at: nowMs), let remaining = remainingMs(at: nowMs) else { return nil }
        let left = CacheFormat.duration(ms: remaining, estimated: confidence == .estimated)
        return "Cache warm (\(CacheFormat.tokens(cachedTokens ?? 0)) tokens, \(left) left) — switching models will re-cache"
    }

    /// The overflow's lines: how much of the last prompt was cached, and when the window closes,
    /// as a time of day, since a menu is drawn once and a countdown in it would go stale.
    func breakdown(clock: (Int64) -> String = CacheFormat.timeOfDay) -> [String] {
        guard (cachedTokens ?? 0) > 0 || ttlMs != nil else { return [] }
        var lines: [String] = []
        if let cachedTokens, let promptTokens, let hitPercent {
            lines.append("\(CacheFormat.tokens(cachedTokens)) of \(CacheFormat.tokens(promptTokens)) prompt tokens cached (\(hitPercent)%)")
        }
        if let expiresAtMs {
            lines.append((confidence == .estimated ? "Expires about " : "Expires ") + clock(expiresAtMs))
        }
        return lines
    }
}

nonisolated enum CacheFormat {
    /// "1h 02m", "3m 42s", "42s"; an estimate drops the seconds behind a "~": "~3m".
    static func duration(ms: Int64, estimated: Bool) -> String {
        estimated ? "~" + span(ms: ms, coarse: true) : span(ms: ms, coarse: false)
    }

    /// Whole seconds counted up, so "1s" shows until the very end.
    static func span(ms: Int64, coarse: Bool) -> String {
        let seconds = (max(0, ms) + 999) / 1000
        let hours = seconds / 3600, minutes = seconds % 3600 / 60, secs = seconds % 60
        if hours > 0 { return "\(hours)h " + String(format: "%02lldm", minutes) }
        if minutes > 0 { return coarse ? "\(minutes)m" : "\(minutes)m " + String(format: "%02llds", secs) }
        return "\(secs)s"
    }

    /// "842", "142k", "1.2M".
    static func tokens(_ count: Int64) -> String {
        if count < 1000 { return "\(count)" }
        if count < 1_000_000 { return "\(count / 1000)k" }
        return String(format: "%.1fM", Double(count) / 1_000_000)
    }

    /// How long until the shown second changes: the moment the next whole second falls past.
    static func nextTickMs(remainingMs: Int64) -> Int64 {
        (max(1, remainingMs) - 1) % 1000 + 1
    }

    static func timeOfDay(_ ms: Int64) -> String {
        Date(unixMilliseconds: ms).formatted(date: .omitted, time: .shortened)
    }
}

/// Each moment the countdown's second changes, up to the expiry, then nothing: an expired or
/// lifetime-less window is drawn once and never wakes its view again.
nonisolated struct CacheCountdown: TimelineSchedule {
    let expiresAtMs: Int64?

    init(_ cache: CacheWindow) {
        expiresAtMs = cache.expiresAtMs
    }

    func entries(from start: Date, mode _: TimelineScheduleMode) -> some Sequence<Date> {
        sequence(first: start) { [expiresAtMs] date in
            guard let expiresAtMs else { return nil }
            let remaining = expiresAtMs - date.unixMilliseconds
            guard remaining > 0 else { return nil }
            return date.addingTimeInterval(Double(CacheFormat.nextTickMs(remainingMs: remaining)) / 1000)
        }
    }
}
