import BroskiCore
import SwiftUI

extension StatsRange {
    static let ordered: [StatsRange] = [.day, .week, .month, .quarter, .year, .all]

    var shortName: String {
        switch self {
        case .day: "24h"
        case .week: "7d"
        case .month: "30d"
        case .quarter: "90d"
        case .year: "1y"
        case .all: "All"
        }
    }

    /// The period a change is measured against: "the previous 30 days"; nil where there is no before.
    var previousPeriod: String? {
        switch self {
        case .day: "the day before"
        case .week: "the week before"
        case .month: "the previous 30 days"
        case .quarter: "the previous 90 days"
        case .year: "the year before"
        case .all: nil
        }
    }
}

extension StatsHarness {
    var displayName: String {
        switch self {
        case .pi: "Pi"
        case .claude: "Claude Code"
        case .codex: "Codex"
        case .opencode: "OpenCode"
        case .antigravity: "Antigravity"
        case .grok: "Grok"
        case .gemini: "Gemini CLI"
        }
    }

    var tint: Color {
        switch self {
        case .claude: Color(light: 0xC15F3C, dark: 0xD97757)
        case .pi: Color(light: 0x7C3AED, dark: 0xA78BFA)
        case .codex: Color(light: 0x059669, dark: 0x34D399)
        case .opencode: Color(light: 0x2563EB, dark: 0x60A5FA)
        case .antigravity: Color(light: 0x1A73E8, dark: 0x5B9DFF)
        case .grok: Color(light: 0xD97706, dark: 0xFBBF24)
        case .gemini: Color(light: 0x0D9488, dark: 0x2DD4BF)
        }
    }
}

extension StatsTokenTotals {
    var total: Int64 {
        uncachedInput + cachedInput + cacheCreation + output
    }

    var promptTotal: Int64 {
        uncachedInput + cachedInput + cacheCreation
    }

    var cacheHitRate: Double? {
        guard promptTotal > 0 else { return nil }
        return Double(cachedInput) / Double(promptTotal)
    }
}

enum StatsFormat {
    static func usd(_ value: Double) -> String {
        let absVal = abs(value)
        if absVal >= 1_000_000 {
            return String(format: "$%.2fM", value / 1_000_000)
        }
        if absVal >= 10_000 {
            return String(format: "$%.1fK", value / 1_000)
        }
        if absVal >= 100 {
            return "$\(Int(value.rounded()).formatted())"
        }
        if absVal >= 1 {
            return String(format: "$%.2f", value)
        }
        if absVal == 0 {
            return "$0.00"
        }
        return String(format: absVal >= 0.01 ? "$%.2f" : "$%.3f", value)
    }

    /// The headline figure, whole dollars once there are a hundred: "$10,742", "$84.20".
    static func usdFigure(_ value: Double) -> String {
        value >= 100
            ? value.formatted(.currency(code: "USD").precision(.fractionLength(0)))
            : value.formatted(.currency(code: "USD").precision(.fractionLength(2)))
    }

    /// A figure as short as it reads: "$358", "$1.2K", "1.6B".
    static func compact(_ value: Double, metric: StatsMetric) -> String {
        metric == .cost ? usd(value) : tokens(Int64(value))
    }

    static func tokens(_ count: Int64) -> String {
        let value = Double(count)
        let absVal = abs(value)
        if absVal < 1_000 {
            return "\(count)"
        }
        let units: [(Double, String)] = [
            (1_000_000_000_000, "T"),
            (1_000_000_000, "B"),
            (1_000_000, "M"),
            (1_000, "K"),
        ]
        for (scale, suffix) in units where absVal >= scale {
            let scaled = value / scale
            return scaled >= 100 ? "\(Int(scaled.rounded()))\(suffix)" : String(format: "%.1f%@", scaled, suffix)
        }
        return "\(count)"
    }

    static func percent(_ ratio: Double) -> String {
        guard ratio.isFinite else { return "—" }
        let pct = ratio * 100
        if pct > 0 && pct < 0.1 { return "<0.1%" }
        return pct >= 10 ? "\(Int(pct.rounded()))%" : String(format: "%.1f%%", pct)
    }

    static func delta(current: Double, previous: Double?) -> String? {
        guard let previous, previous > 0 else { return nil }
        let pct = ((current - previous) / previous) * 100
        let rounded = Int(pct.rounded())
        if rounded == 0 { return "0%" }
        let clamped = min(999, abs(rounded))
        let prefix = rounded > 0 ? "+" : "-"
        return abs(rounded) > 999 ? "\(prefix)999%+" : "\(prefix)\(clamped)%"
    }

    /// Where the money figures come from, in a sentence.
    static func costNote(_ source: StatsCostSource) -> String? {
        switch source {
        case .providerReported: "Costs are what each provider reported."
        case .apiEstimate, .mixed: "Costs are what the same use would cost at API prices."
        case .unpriced: nil
        }
    }
}
