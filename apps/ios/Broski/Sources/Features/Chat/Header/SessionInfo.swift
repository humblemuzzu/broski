import BroskiCore
import Foundation

/// One row of Session Info: what it is, and its value in words.
nonisolated struct InfoLine: Hashable {
    let label: String
    let value: String
}

nonisolated extension Usage {
    /// "64k / 200k", or "64k" when the window is not reported.
    var contextLine: String? {
        guard let contextTokens else { return nil }
        let used = CacheFormat.tokens(contextTokens)
        return contextWindow.map { "\(used) / \(CacheFormat.tokens($0))" } ?? used
    }

    /// The token counts the backend reported, each in full.
    func tokenLines(locale: Locale = .current) -> [InfoLine] {
        let counts: [(String, Int64?)] = [
            ("Input", inputTokens), ("Output", outputTokens), ("Cache read", cacheReadTokens),
            ("Cache write", cacheWriteTokens), ("Reasoning", reasoningTokens),
        ]
        return counts.compactMap { label, count in
            count.map { InfoLine(label: label, value: $0.formatted(.number.locale(locale))) }
        }
    }

    /// "$0.42"; a cost under a cent keeps up to four decimals rather than reading "$0.00".
    func costLine(locale: Locale = .current) -> String? {
        costUsd.map { $0.formatted(.currency(code: "USD").precision(.fractionLength(2...4)).locale(locale)) }
    }
}

nonisolated extension CacheWindow {
    /// "3m 42s left" while warm; nothing once the lifetime ran out or without one.
    func remainingLine(nowMs: Int64) -> String? {
        guard let remaining = remainingMs(at: nowMs), remaining > 0 else { return nil }
        return CacheFormat.duration(ms: remaining, estimated: confidence == .estimated) + " left"
    }

    /// The hit ratio, the cached share of the prompt, and when the window closes or closed as a time
    /// of day.
    func infoLines(nowMs: Int64, clock: (Int64) -> String = CacheFormat.timeOfDay) -> [InfoLine] {
        var lines: [InfoLine] = []
        if let hitPercent { lines.append(InfoLine(label: "Hit ratio", value: "\(hitPercent)%")) }
        if let cachedTokens {
            let cached = CacheFormat.tokens(cachedTokens)
            let value = promptTokens.map { "\(cached) of \(CacheFormat.tokens($0)) prompt tokens" } ?? "\(cached) tokens"
            lines.append(InfoLine(label: "Cached", value: value))
        }
        if let expiresAtMs {
            let closed = expiresAtMs <= nowMs
            let estimate = !closed && confidence == .estimated ? "about " : ""
            lines.append(InfoLine(label: closed ? "Expired" : "Expires", value: estimate + clock(expiresAtMs)))
        }
        return lines
    }
}
