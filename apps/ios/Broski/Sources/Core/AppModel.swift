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
    let notifications = NotificationAccess()
    let push: PushNotifications
    let discovery = LanDiscovery()
    /// Set to show a session; the Inbox tab opens it and sets this back to `nil`.
    var sessionToOpen: SessionTarget?
    /// The session on screen, set by the chat while it shows one and cleared when it leaves: its
    /// pushes do not banner while the app is in front.
    var visibleSession: SessionTarget?
    /// What the person was writing in each chat, kept when they leave it.
    let drafts = DraftStore()
    let dictation = Dictation()

    @ObservationIgnored private let storage: PhoneStorage
    @ObservationIgnored private var phone: Phone?
    @ObservationIgnored private var pathWatcher: PathWatcher?
    @ObservationIgnored private var isActive = false
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
        push.visibleSession = { [weak self] in self?.visibleSession }
    }

    var isPaired: Bool { !machines.isEmpty || !unreadablePairings.isEmpty }

    func machine(id: String) -> MachineModel? {
        machines.first { $0.id == id }
    }

    /// Opens the phone from the stored identity and starts every stored machine. Safe to call
    /// again after a failure; a running phone is left alone.
    func start() {
        guard phone == nil else { return }
        push.start()
        RunStopper.stop = { [weak self] machineId, backend, sessionId in
            guard let backend = BackendId(wireName: backend) else { return }
            await self?.stopRun(machineId: machineId, session: SessionRef(backend: backend, sessionId: sessionId))
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
        machines.removeAll { $0.id == model.id }
        updateDiscovery()
    }

    func forgetUnreadablePairing(id: String) {
        removeRecord(id: id)
        unreadablePairings.removeAll { $0 == id }
    }

    func markSeen(machineId: String, session: SessionRef) {
        inbox.markSeen(machineId: machineId, session: session)
    }

    /// Stop from the Live Activity, which may run the app in the background just for it: the link
    /// is resumed for the request and paused again after. The bridge takes `abort` only for a session
    /// the phone views, so the session is viewed while it is sent.
    func stopRun(machineId: String, session: SessionRef) async {
        guard let machine = machine(id: machineId) else { return }
        if !isActive { phone?.resume() }
        do {
            let view = try machine.machine.attach(session: session)
            defer { view.detach() }
            let answer = try await machine.machine.request(message: .abort(AbortRequest(requestId: "", session: session)))
            Logger.core.info("a run was stopped from the Live Activity: \(String(describing: answer), privacy: .public)")
        } catch {
            Logger.core.error("the stop was not sent: \(String(describing: error), privacy: .public)")
        }
        if !isActive { phone?.pause() }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            isActive = true
            phone?.resume()
            endDelivery()
            // An activity can only start in front; one that a background change could not start
            // starts now.
            liveRuns?.follow(inbox.rows, reachableMachines: reachableMachineIds)
            Task { await notifications.refresh() }
        case .background:
            isActive = false
            dictation.sceneLeft()
            holdForDelivery()
        default:
            break
        }
        updateDiscovery()
    }

    private var reachableMachineIds: Set<String> {
        Set(machines.filter { $0.summary.isReady }.map(\.id))
    }

    private var hasLiveWork: Bool {
        let reachable = reachableMachineIds
        return inbox.rows.contains {
            !$0.cached && reachable.contains($0.machineId) && ($0.state == .working || $0.state == .needsYou)
        }
    }

    /// iOS suspends the app moments after it leaves the screen; the background time held here lets
    /// a prompt sent just before reach the Mac and keeps a short run's Live Activity live until the
    /// run finishes or iOS ends the background window, at which point the link pauses and the
    /// activity ends so no timer ticks on its own while disconnected.
    private func holdForDelivery() {
        guard let phone else { return }
        endDelivery()
        delivery = UIApplication.shared.beginBackgroundTask(withName: "Broski delivery") { [weak self] in
            guard let self else { return }
            self.phone?.pause()
            Task {
                await self.liveRuns?.suspend()
                self.endDelivery()
            }
        }
        let held = delivery
        Task { [weak self] in
            while let self, !self.isActive, self.delivery == held, self.hasLiveWork {
                try? await Task.sleep(for: .milliseconds(500))
            }
            guard let self, !self.isActive, self.delivery == held else { return }
            phone.pause()
            await phone.paused()
            guard !self.isActive, self.delivery == held else { return }
            await self.liveRuns?.suspend()
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
        pathWatcher = PathWatcher { [weak self] in
            self?.phone?.networkChanged()
            self?.discovery.networkChanged()
        }
        updateDiscovery()
    }

    /// The Live Activity follows the inbox and each machine's reachability for the life of the phone.
    private func followLiveRuns() {
        let liveRuns = LiveRuns()
        self.liveRuns = liveRuns
        Task { [weak self] in
            guard let self else { return }
            for await (rows, reachable) in Observations({ (self.inbox.rows, self.reachableMachineIds) }) {
                liveRuns.follow(rows, reachableMachines: reachable)
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
