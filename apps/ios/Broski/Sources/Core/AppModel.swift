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
    let discovery = LanDiscovery()

    @ObservationIgnored private let storage: PhoneStorage
    @ObservationIgnored private var phone: Phone?
    @ObservationIgnored private var pathWatcher: PathWatcher?
    @ObservationIgnored private var isActive = false

    init(storage: PhoneStorage = PhoneStorage()) {
        self.storage = storage
        discovery.found = { [weak self] machineId, route in
            self?.machine(id: machineId)?.machine.lanDiscovered(routes: [route])
        }
    }

    var isPaired: Bool { !machines.isEmpty || !unreadablePairings.isEmpty }

    func machine(id: String) -> MachineModel? {
        machines.first { $0.id == id }
    }

    /// Opens the phone from the stored identity and starts every stored machine. Safe to call
    /// again after a failure; a running phone is left alone.
    func start() {
        guard phone == nil else { return }
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

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            isActive = true
            phone?.resume()
            Task { await notifications.refresh() }
        case .background:
            isActive = false
            phone?.pause()
        default:
            break
        }
        updateDiscovery()
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

    /// The seen state goes back before any machine starts, as the core requires.
    private func restore(into phone: Phone) {
        let core = phone.inbox()
        do throws(Keychain.Failure) {
            if let seen = try storage.seenState() { core.restoreSeen(state: seen) }
        } catch {
            Logger.core.error("the seen state was not read: \(error.status)")
        }
        inbox.start(core, storage: storage)

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
        pathWatcher = PathWatcher { [weak self] in
            self?.phone?.networkChanged()
            self?.discovery.networkChanged()
        }
        updateDiscovery()
    }

    private func adopt(_ machine: Machine) -> MachineModel {
        let model = MachineModel(machine: machine, records: storage.records)
        self.machine(id: model.id)?.retire()
        model.persistRecord()
        machines.removeAll { $0.id == model.id }
        unreadablePairings.removeAll { $0 == model.id }
        add(model)
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
