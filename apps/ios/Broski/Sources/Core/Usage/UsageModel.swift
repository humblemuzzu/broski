import BroskiCore
import Foundation
import Observation
import WidgetKit
import os

/// The plans' usage as the paired Macs read it (`plan.usage`), kept in the app group so the widgets
/// draw it while the app is closed, and redrawn there each time it changes.
@Observable
final class UsageModel {
    /// Reading more often only gets the bridge's own minute-old answer back.
    static let minimumGap: TimeInterval = 60

    private(set) var report: UsageReport?
    private(set) var isReading = false

    @ObservationIgnored private var lastRead: Date?
    @ObservationIgnored private let save: @MainActor (UsageReport) -> Void

    init(
        load: () -> UsageReport? = { UsageStore.shared.load() },
        save: @escaping @MainActor (UsageReport) -> Void = UsageModel.publish
    ) {
        report = load()
        self.save = save
    }

    /// Asks every ready Mac, at most once a minute unless `force`. A Mac that does not answer
    /// changes nothing, so the widgets keep the last reading rather than going blank.
    func refresh(from machines: [MachineModel], force: Bool = false) async {
        guard !isReading else { return }
        if !force, let lastRead, Date.now.timeIntervalSince(lastRead) < Self.minimumGap { return }
        let ready = machines.filter(\.summary.isReady)
        guard !ready.isEmpty else { return }
        isReading = true
        defer { isReading = false }
        lastRead = .now
        var answers: [[PlanReport]] = []
        for machine in ready {
            if let plans = await Self.read(machine) { answers.append(plans) }
        }
        guard !answers.isEmpty else { return }
        apply(Self.merged(answers.flatMap(\.self)))
    }

    func apply(_ plans: [PlanReport]) {
        guard plans != report?.plans else { return }
        let next = UsageReport(plans: plans, savedAt: .now)
        report = next
        save(next)
    }

    /// One report per plan, in the order the Macs first gave them: when two Macs read the same
    /// account, the newer reading.
    static func merged(_ plans: [PlanReport]) -> [PlanReport] {
        var order: [UsagePlan] = []
        var newest: [UsagePlan: PlanReport] = [:]
        for report in plans {
            if let kept = newest[report.plan] {
                if (report.readAt ?? .distantPast) > (kept.readAt ?? .distantPast) { newest[report.plan] = report }
            } else {
                order.append(report.plan)
                newest[report.plan] = report
            }
        }
        return order.compactMap { newest[$0] }
    }

    /// The Mac's plans, or nil when it gave no answer (an older bridge answers `unsupported`).
    private static func read(_ machine: MachineModel) async -> [PlanReport]? {
        do {
            let answer = try await machine.machine.request(message: .planUsage(PlanUsageRequest(requestId: "")))
            guard case .planUsageResult(let response) = answer else { return nil }
            switch response.result {
            case .accepted(let usage):
                return usage.meters.map { PlanReport($0, machineName: machine.name) }
            case .rejected(let rejected):
                Logger.core.info("\(machine.name, privacy: .public) read no plan usage: \(rejected.rejection.message, privacy: .public)")
                return nil
            }
        } catch {
            Logger.core.error("plan usage was not read: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Writes the report where the widgets read it and has them draw it again.
    static func publish(_ report: UsageReport) {
        UsageStore.shared.save(report)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

extension PlanReport {
    init(_ meter: PlanMeter, machineName: String) {
        self.init(
            plan: UsagePlan(id: meter.plan),
            displayName: meter.displayName,
            tier: meter.tier,
            windows: meter.windows.map(LimitWindow.init),
            readAt: meter.readAt.map(Date.init(unixMilliseconds:)),
            problem: meter.problem,
            machineName: machineName)
    }
}

extension LimitWindow {
    init(_ window: UsageWindow) {
        let span: LimitSpan = switch window.span {
        case .fiveHour: .fiveHour
        case .week: .week
        }
        self.init(
            id: window.id, span: span, scope: window.scope, usedPercent: window.usedPercent,
            resetsAt: window.resetsAt.map(Date.init(unixMilliseconds:)),
            history: (window.history ?? []).map {
                UsagePoint(at: Date(unixMilliseconds: $0.at), usedPercent: $0.usedPercent)
            })
    }
}
