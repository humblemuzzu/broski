import BroskiCore
import Foundation
import Observation
import SwiftUI
import os

/// The app's one `Phone`, every paired machine, the inbox, and the platform services the core
/// needs: the scene's foreground, network path changes and LAN discovery.
@Observable
final class AppModel {
    enum Launch: Equatable {
        case starting
        case ready
        case unavailable(IdentityProblem)
    }

    private(set) var launch: Launch = .starting
    /// Paired machines, oldest pairing first.
    private(set) var machines: [MachineModel] = []
    /// Stored pairings whose record no longer reads; the Machines screen offers to forget them.
    private(set) var unreadablePairings: [String] = []
    let inbox = InboxModel()
    let sessionPreferences = SessionPreferences()
    let modelPreferences = ModelPreferences()
    let notifications = NotificationAccess()
    let push: PushNotifications
    let discovery = LanDiscovery()
    /// Set to show a session; the Inbox tab opens it and sets this back to `nil`.
    var sessionToOpen: SessionTarget?
    /// Set to open a machine's Remote Screen from a macOS dialog push; the Inbox tab clears it.
    var screenMachineToOpen: String?
    /// Set by the tab bar's New Session button; the Inbox tab opens New Session and clears it.
    var startsNewSession = false
    /// Set by the usage widgets' link; the tab shell shows Usage and clears it.
    var opensUsage = false
    /// The session on screen, set by the chat while it shows one and cleared when it leaves: its
    /// pushes do not banner while the app is in front.
    var visibleSession: SessionTarget?
    /// The inbox shows its list rather than a screen pushed over it (a chat, New Session, a session's
    /// files): the tab bar, and the "n agents working" accessory with it, belong to the list alone.
    var inboxAtRoot = true
    /// What the person was writing in each chat, kept when they leave it.
    let drafts = DraftStore()
    let dictation = Dictation()
    let usage = UsageModel()
    let stats = StatsModel()
    private(set) var isActive = false
    var keepScreenAwake: KeepScreenAwake = KeepScreenAwake.current() {
        didSet {
            UserDefaults.standard.set(keepScreenAwake.rawValue, forKey: Preference.keepScreenAwake)
        }
    }

    @ObservationIgnored private let storage: PhoneStorage
    @ObservationIgnored private var phone: Phone?
    @ObservationIgnored private var pathWatcher: PathWatcher?
    @ObservationIgnored private var liveRuns: LiveRuns?
    @ObservationIgnored private var delivery = UIBackgroundTaskIdentifier.invalid

    init(storage: PhoneStorage = PhoneStorage()) {
        self.storage = storage
        push = PushNotifications(records: storage.records)
        discovery.found = { [weak self] machineId, route in
            self?.machine(id: machineId)?.machine.lanDiscovered(routes: [route])
        }
        push.tokenChanged = { [weak self] _ in
            self?.machines.forEach { $0.registerPush(self?.push.token) }
        }
        push.opened = { [weak self] in self?.sessionToOpen = $0 }
        push.openedScreen = { [weak self] in self?.screenMachineToOpen = $0 }
        push.visibleSession = { [weak self] in self?.visibleSession }
    }

    var isPaired: Bool { !machines.isEmpty || !unreadablePairings.isEmpty }

    func machine(id: String) -> MachineModel? {
        machines.first { $0.id == id }
    }

    /// The session's agent as its machine's bridge describes it, or as the phone knows it while
    /// the machine has not.
    func brand(of session: SessionRef, on machineId: String) -> AgentBrand {
        machine(id: machineId)?.brand(for: session.backend) ?? AgentBrand(backend: session.backend)
    }

    /// Every machine's agents by machine id, then backend id.
    var brands: [String: [String: AgentBrand]] {
        Dictionary(machines.map { ($0.id, $0.brands) }) { first, _ in first }
    }

    /// Opens the phone from the stored identity and starts every stored machine. Safe to call
    /// again after a failure; a running phone is left alone.
    func start() {
        guard phone == nil else { return }
        push.start()
        RunStopper.stop = { [weak self] machineId, backend, sessionId in
            guard let target = SessionTarget(machineId: machineId, backend: backend, sessionId: sessionId) else { return }
            await self?.stopRun(machineId: machineId, session: target.session)
        }
        launch = .starting
        do throws(IdentityProblem) {
            let phone = try Self.makePhone(secret: try identitySecret())
            self.phone = phone
            restore(into: phone)
            launch = .ready
        } catch {
            Logger.core.error("the phone did not open: \(String(describing: error), privacy: .public)")
            launch = .unavailable(error)
        }
    }

    /// Forgets this phone's identity and every pairing, then starts over with a new identity.
    /// Offered only when the stored identity cannot be used, and only on the person's word.
    func startOver() {
        do throws(Keychain.Failure) {
            try storage.removeEverything()
        } catch {
            launch = .unavailable(.keychain(error.status))
            return
        }
        sessionPreferences.forgetAll()
        unreadablePairings = []
        start()
    }

    func pair(offer: String) async throws -> MachineModel {
        guard let phone else { throw ClientError.Closed }
        return adopt(try await phone.pair(offer: offer))
    }

    func forget(_ model: MachineModel) {
        model.retire()
        phone?.forget(id: model.id)
        removeRecord(id: model.id)
        sessionPreferences.forgetMachine(model.id)
        machines.removeAll { $0.id == model.id }
        updateDiscovery()
    }

    func forgetUnreadablePairing(id: String) {
        removeRecord(id: id)
        sessionPreferences.forgetMachine(id)
        unreadablePairings.removeAll { $0 == id }
    }

    func markSeen(machineId: String, session: SessionRef) {
        inbox.markSeen(machineId: machineId, session: session)
    }

    func markUnread(machineId: String, session: SessionRef) {
        inbox.markUnread(machineId: machineId, session: session)
    }

    /// The session was deleted on its Mac: nothing kept for it outlives it.
    func sessionDeleted(_ target: SessionTarget) {
        sessionPreferences.removeSession(target)
    }

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
    private func followUsage() {
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

    private var reachableMachineIds: Set<String> {
        Set(machines.filter { $0.summary.isReady }.map(\.id))
    }

    private var settlingMachineIds: Set<String> {
        Set(machines.filter { $0.summary.health == .settling }.map(\.id))
    }

    private var hasLiveWork: Bool {
        let reachable = reachableMachineIds
        return inbox.rows.contains {
            !$0.cached && reachable.contains($0.machineId) && ($0.state == .working || $0.state == .needsYou)
        }
    }

    private var shouldKeepScreenAwake: Bool {
        guard isActive else { return false }
        if dictation.isKeepingScreenAwake { return true }
        switch keepScreenAwake {
        case .dictationOnly: return false
        case .whileWorking: return hasLiveWork
        case .always: return true
        }
    }

    /// Flushes any prompt sent right before backgrounding and closes the link cleanly so the daemon
    /// resumes APNs alerts and Live Activity push updates right away. The expiration handler ends
    /// the background task synchronously on the main thread as UIKit requires.
    private func pauseForBackground() {
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

    private func endDelivery() {
        guard delivery != .invalid else { return }
        UIApplication.shared.endBackgroundTask(delivery)
        delivery = .invalid
    }

    private func identitySecret() throws(IdentityProblem) -> Data {
        let stored: Data?
        do throws(Keychain.Failure) { stored = try storage.identitySecret() } catch { throw .keychain(error.status) }
        if let stored { return stored }
        let pairings: Int
        do throws(Keychain.Failure) { pairings = try storage.records.all().count } catch { throw .keychain(error.status) }
        guard pairings == 0 else { throw .missing }
        let fresh: Data
        do { fresh = try newIdentitySecret() } catch { throw .core(String(describing: error)) }
        do throws(Keychain.Failure) { try storage.saveIdentitySecret(fresh) } catch { throw .keychain(error.status) }
        return fresh
    }

    private static func makePhone(secret: Data) throws(IdentityProblem) -> Phone {
        let config = PhoneConfig(
            deviceName: UIDevice.current.name, platform: .ios, clientName: "Broski for iOS",
            clientVersion: Bundle.main.appVersion)
        do {
            return try Phone(identitySecret: secret, config: config)
        } catch ClientError.Link(failure: .identity, let detail) {
            throw .rejected(detail)
        } catch {
            throw .core(String(describing: error))
        }
    }

    /// The seen state and the last inbox go back before any machine starts, as the core requires;
    /// the inbox's loop starts once the machines have, so its first rows are the cached ones.
    private func restore(into phone: Phone) {
        let core = phone.inbox()
        restoreInbox(core)
        sessionPreferences.load(from: storage)
        let records: [(id: String, bytes: Data)]
        do throws(Keychain.Failure) {
            records = try storage.records.all()
        } catch {
            Logger.core.error("the machine records were not read: \(error.status)")
            records = []
        }
        for (id, bytes) in records {
            do {
                let machine = try phone.start(record: try MachineRecord.fromBytes(bytes: bytes))
                add(MachineModel(machine: machine, records: storage.records))
            } catch {
                Logger.core.error("the record of \(id, privacy: .public) did not start: \(String(describing: error), privacy: .public)")
                unreadablePairings.append(id)
            }
        }
        inbox.start(core, storage: storage)
        followLiveRuns()
        followIdleTimer()
        followUsage()
        pathWatcher = PathWatcher { [weak self] in
            self?.phone?.networkChanged()
            self?.discovery.networkChanged()
        }
        updateDiscovery()
    }

    /// The Live Activity follows the inbox and each machine's state for the life of the phone.
    private func followLiveRuns() {
        let liveRuns = LiveRuns()
        liveRuns.setForeground(isActive)
        liveRuns.onPushToken = { [weak self] token in
            self?.machines.forEach { $0.registerLiveActivity(token) }
        }
        if let token = liveRuns.currentPushToken {
            machines.forEach { $0.registerLiveActivity(token) }
        }
        self.liveRuns = liveRuns
        Task { [weak self] in
            guard let self else { return }
            for await (rows, brands, ready, settling) in Observations({
                (self.inbox.rows, self.brands, self.reachableMachineIds, self.settlingMachineIds)
            }) {
                liveRuns.follow(rows, brands: brands, readyMachines: ready, settlingMachines: settling)
            }
        }
    }

    /// Single owner of `UIApplication.shared.isIdleTimerDisabled`: keeps the display awake during
    /// active dictation and per the person's Settings › Keep Screen Awake preference, and resets it
    /// to `false` whenever the scene is not active.
    private func followIdleTimer() {
        Task { [weak self] in
            guard let self else { return }
            var current = false
            for await awake in Observations({ self.shouldKeepScreenAwake }) {
                guard awake != current else { continue }
                current = awake
                UIApplication.shared.isIdleTimerDisabled = awake
            }
        }
    }

    private func restoreInbox(_ core: Inbox) {
        do throws(Keychain.Failure) {
            if let seen = try storage.seenState() { core.restoreSeen(state: seen) }
            if let cache = try storage.inboxCache() { restoreCache(cache, into: core) }
        } catch {
            Logger.core.error("the inbox's stored state was not read: \(error.status)")
        }
    }

    /// A cache the core refuses (another version's) is left for the core's next one to replace.
    private func restoreCache(_ cache: Data, into core: Inbox) {
        do {
            try core.restoreCache(cache: cache)
        } catch {
            Logger.core.error("the inbox cache was refused: \(String(describing: error), privacy: .public)")
        }
    }

    private func adopt(_ machine: Machine) -> MachineModel {
        let model = MachineModel(machine: machine, records: storage.records)
        self.machine(id: model.id)?.retire()
        model.persistRecord()
        machines.removeAll { $0.id == model.id }
        unreadablePairings.removeAll { $0 == model.id }
        add(model)
        model.registerPush(push.token)
        model.registerLiveActivity(liveRuns?.currentPushToken)
        updateDiscovery()
        return model
    }

    private func add(_ model: MachineModel) {
        machines.append(model)
        machines.sort { $0.pairedAt < $1.pairedAt }
        model.start()
    }

    private func removeRecord(id: String) {
        do throws(Keychain.Failure) {
            try storage.records.remove(id: id)
        } catch {
            Logger.core.error("the record of \(id, privacy: .public) was not removed: \(error.status)")
        }
    }

    private func updateDiscovery() {
        if isActive && !machines.isEmpty {
            discovery.start()
        } else {
            discovery.stop()
        }
    }
}

/// Why the phone could not open. None of these makes a new identity by itself: pairings are tied
/// to the identity, so a new one would orphan every Mac this phone controls.
enum IdentityProblem: Error, Equatable {
    /// The keychain refused to read or write the identity (an `OSStatus`).
    case keychain(OSStatus)
    /// No identity is stored, yet pairings are.
    case missing
    /// The core refused the stored identity.
    case rejected(String)
    case core(String)
}

extension Bundle {
    var appVersion: String {
        object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    var buildNumber: String {
        object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }
}
