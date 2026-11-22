import BroskiCore
import Foundation
import Observation
import os

enum StatsMetric: String, CaseIterable, Identifiable {
    case cost
    case tokens

    var id: String { rawValue }

    var shortName: String {
        switch self {
        case .cost: "Cost"
        case .tokens: "Tokens"
        }
    }
}

/// Cross-agent token and API-equivalent cost stats (`stats.summary`), merged across all paired Macs
/// by `BroskiCore.mergeStatsSummaries`.
@Observable
final class StatsModel {
    static let minimumGap: TimeInterval = 30

    private(set) var summary: StatsSummary?
    private(set) var isReading = false
    var range: StatsRange = .month
    var metric: StatsMetric = .cost
    var selectedHarness: StatsHarness?

    @ObservationIgnored private var lastKey: String?
    @ObservationIgnored private var lastRead: Date?
    @ObservationIgnored private var pendingPoll: Task<Void, Never>?
    @ObservationIgnored private var pendingForce = false
    @ObservationIgnored private var needsReload = false

    func refresh(from machines: [MachineModel], force: Bool = false) async {
        if isReading {
            needsReload = true
            pendingForce = pendingForce || force
            return
        }
        let ready = machines.filter(\.summary.isReady)
        guard !ready.isEmpty else { return }

        isReading = true
        defer { isReading = false }

        var requestForce = force
        repeat {
            needsReload = false
            pendingForce = false
            let requestedRange = range
            let requestedHarness = selectedHarness
            let key = "\(requestedRange)|\(requestedHarness.map(String.init(describing:)) ?? "all")"
            if !requestForce, key == lastKey, let lastRead, Date.now.timeIntervalSince(lastRead) < Self.minimumGap {
                break
            }
            let tz = TimeZone.current.identifier
            var answers: [StatsSummary] = []
            for machine in machines.filter(\.summary.isReady) {
                if let item = await Self.read(
                    machine,
                    range: requestedRange,
                    harness: requestedHarness,
                    timeZone: tz,
                    force: requestForce
                ) {
                    answers.append(item)
                }
            }
            if range == requestedRange, selectedHarness == requestedHarness, !answers.isEmpty,
               let merged = mergeStatsSummaries(summaries: answers) {
                summary = merged
                lastKey = key
                lastRead = .now
                scheduleFollowUpIfScanning(merged, machines: machines)
            }
            requestForce = pendingForce
        } while needsReload
    }

    func selectRange(_ next: StatsRange, machines: [MachineModel]) async {
        guard range != next else { return }
        range = next
        await refresh(from: machines, force: true)
    }

    func toggleHarness(_ harness: StatsHarness, machines: [MachineModel]) async {
        selectedHarness = selectedHarness == harness ? nil : harness
        await refresh(from: machines, force: true)
    }

    func clearHarness(machines: [MachineModel]) async {
        guard selectedHarness != nil else { return }
        selectedHarness = nil
        await refresh(from: machines, force: true)
    }

    private func scheduleFollowUpIfScanning(_ current: StatsSummary, machines: [MachineModel]) {
        pendingPoll?.cancel()
        guard current.scanState != .fresh else { return }
        pendingPoll = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            self?.lastRead = nil
            await self?.refresh(from: machines, force: false)
        }
    }

    private static func read(
        _ machine: MachineModel,
        range: StatsRange,
        harness: StatsHarness?,
        timeZone: String,
        force: Bool
    ) async -> StatsSummary? {
        let req = StatsSummaryRequest(
            requestId: "",
            range: range,
            harness: harness,
            timeZone: timeZone,
            refresh: force ? true : nil
        )
        do {
            let answer = try await machine.machine.request(message: .statsSummary(req))
            guard case .statsSummaryResult(let response) = answer else { return nil }
            switch response.result {
            case .accepted(let stats):
                return stats
            case .rejected(let rejected):
                Logger.core.info("\(machine.name, privacy: .public) stats unavailable: \(rejected.rejection.message, privacy: .public)")
                return nil
            }
        } catch {
            Logger.core.error("stats request failed: \(String(describing: error), privacy: .public)")
            return nil
        }
    }
}
