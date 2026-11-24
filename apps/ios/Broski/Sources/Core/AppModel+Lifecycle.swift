import BroskiCore
import Foundation
import Observation
import SwiftUI
import os

/// Scene phase, background link pause/resume, Live Activity Stop handling, and usage refresh for `AppModel`.
extension AppModel {
    /// Stop from the Live Activity, which may run the app in the background just for it: the link
    /// is resumed for the request, waits for the Mac and view attach, sends abort, stays up until
    /// the run's end has reached the activity, then pauses and flushes before returning.
    func stopRun(machineId: String, session: SessionRef) async {
        guard let machine = machine(id: machineId) else { return }
        let wasBackground = !isActive
        if wasBackground { phone?.resume() }
        let readyDeadline = ContinuousClock.now + .seconds(8)
        while !machine.summary.isReady, ContinuousClock.now < readyDeadline {
            try? await Task.sleep(for: .milliseconds(150))
        }
        var stopped = false
        do {
            let view = try machine.machine.attach(session: session)
            defer { view.detach() }
            await waitForAttach(view, timeout: .seconds(4))
            let answer = try await machine.machine.request(message: .abort(AbortRequest(requestId: "", session: session)))
            Logger.core.info("a run was stopped from the Live Activity: \(String(describing: answer), privacy: .public)")
            if case .abortResult(let response) = answer, case .accepted = response.result { stopped = true }
        } catch {
            Logger.core.error("the stop was not sent: \(String(describing: error), privacy: .public)")
        }
        if wasBackground && !isActive {
            if stopped {
                await liveRuns?.settle(leaving: InboxRow.Key(machineId: machineId, session: session), within: .seconds(6))
            }
            phone?.pause()
            await phone?.paused()
        }
    }

    private func waitForAttach(_ view: SessionView, timeout: Duration) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { _ = await view.nextUpdate() }
            group.addTask { try? await Task.sleep(for: timeout) }
            await group.next()
            group.cancelAll()
        }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            isActive = true
            endDelivery()
            phone?.resume()
            liveRuns?.setForeground(true)
            Task { await notifications.refresh() }
            refreshUsage()
        case .inactive:
            isActive = false
        case .background:
            isActive = false
            liveRuns?.setForeground(false)
            dictation.sceneLeft()
            pauseForBackground()
            UsageRefresh.schedule()
        @unknown default:
            isActive = false
        }
        updateDiscovery()
    }

    func refreshUsage(force: Bool = false) {
        Task { await usage.refresh(from: machines, force: force) }
    }

    /// The background refresh: the link is resumed for it, given a moment to reach a Mac, and paused
    /// again after, as for Stop on the Live Activity.
    func refreshUsageInBackground() async {
        UsageRefresh.schedule()
        guard let phone, !machines.isEmpty else { return }
        if !isActive { phone.resume() }
        let deadline = ContinuousClock.now + UsageRefresh.connectTimeout
        while !machines.contains(where: \.summary.isReady), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(250))
        }
        await usage.refresh(from: machines, force: true)
        if !isActive { phone.pause() }
    }

    /// Usage is read again when a Mac connects, when a run ends, and every five minutes in front.
    func followUsage() {
        Task { [weak self] in
            guard let self else { return }
            var reachable: Set<String> = []
            var working = 0
            for await (nowReachable, nowWorking) in Observations({ (self.reachableMachineIds, self.inbox.workingCount) }) {
                let connected = !nowReachable.isSubset(of: reachable)
                let ended = nowWorking < working
                (reachable, working) = (nowReachable, nowWorking)
                if connected || ended { refreshUsage(force: connected) }
            }
        }
        Task { [weak self] in
            while true {
                try? await Task.sleep(for: .seconds(5 * 60))
                guard let self else { return }
                if self.isActive { self.refreshUsage() }
            }
        }
    }

    /// Flushes any prompt sent right before backgrounding and closes the link cleanly so the daemon
    /// resumes APNs alerts and Live Activity push updates right away. The expiration handler ends
    /// the background task synchronously on the main thread as UIKit requires.
    func pauseForBackground() {
        guard let phone else { return }
        endDelivery()
        phone.pause()
        var taskId = UIBackgroundTaskIdentifier.invalid
        taskId = UIApplication.shared.beginBackgroundTask(withName: "Broski pause") { [weak self] in
            if taskId != .invalid {
                UIApplication.shared.endBackgroundTask(taskId)
                taskId = .invalid
            }
            self?.delivery = .invalid
        }
        delivery = taskId
        guard taskId != .invalid else { return }
        let held = taskId
        Task { [weak self] in
            await phone.paused()
            guard let self, self.delivery == held else { return }
            self.endDelivery()
        }
    }

    func endDelivery() {
        guard delivery != .invalid else { return }
        UIApplication.shared.endBackgroundTask(delivery)
        delivery = .invalid
    }
}
