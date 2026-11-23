import BroskiCore
import Foundation

/// The series as the chart draws it: one bucket per hour, day or week, each with what every agent
/// spent in it. A day series longer than `daysUpTo` is drawn by week, so a year reads as a shape
/// rather than a comb.
nonisolated struct StatsBuckets: Equatable {
    enum Unit: Equatable {
        case hour, day, week

        var component: Calendar.Component {
            switch self {
            case .hour: .hour
            case .day: .day
            case .week: .weekOfYear
            }
        }
    }

    struct Slice: Equatable {
        let harness: StatsHarness
        let costUsd: Double
        let tokens: Int64
    }

    struct Bucket: Equatable, Identifiable {
        let start: Date
        var costUsd: Double
        var tokens: Int64
        var turns: Int64
        var slices: [Slice]

        var id: Date { start }

        func value(_ metric: StatsMetric) -> Double {
            metric == .cost ? costUsd : Double(tokens)
        }
    }

    static let daysUpTo = 120

    let unit: Unit
    let buckets: [Bucket]

    init(series: [StatsSeriesPoint], resolution: StatsResolution, calendar: Calendar = .current) {
        let hourly = resolution == .hour
        let unit: Unit = hourly ? .hour : series.count > Self.daysUpTo ? .week : .day
        var buckets: [Bucket] = []
        for point in series {
            guard let date = hourly ? Self.hour(point.key) : Self.day(point.key, calendar: calendar) else { continue }
            let start = unit == .week ? calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date : date
            if let last = buckets.indices.last, buckets[last].start == start {
                buckets[last].add(point)
            } else {
                var bucket = Bucket(start: start, costUsd: 0, tokens: 0, turns: 0, slices: [])
                bucket.add(point)
                buckets.append(bucket)
            }
        }
        self.unit = unit
        self.buckets = buckets
    }

    func bucket(at date: Date, calendar: Calendar = .current) -> Bucket? {
        buckets.last { $0.start <= date && calendar.date(byAdding: unit.component, value: 1, to: $0.start).map { date < $0 } ?? false }
    }

    /// A day key, "2026-11-17", is the Mac's day in the phone's time zone, which the request named.
    private static func day(_ key: String, calendar: Calendar) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// An hour key, "2026-11-17T14", is in UTC.
    private static func hour(_ key: String) -> Date? {
        try? Date("\(key):00:00Z", strategy: .iso8601)
    }
}

nonisolated private extension StatsBuckets.Bucket {
    mutating func add(_ point: StatsSeriesPoint) {
        costUsd += point.costUsd
        tokens += point.totalTokens
        turns += point.turns
        for slice in point.byHarness {
            if let index = slices.firstIndex(where: { $0.harness == slice.harness }) {
                let kept = slices[index]
                slices[index] = .init(harness: kept.harness, costUsd: kept.costUsd + slice.costUsd, tokens: kept.tokens + slice.totalTokens)
            } else {
                slices.append(.init(harness: slice.harness, costUsd: slice.costUsd, tokens: slice.totalTokens))
            }
        }
    }
}
