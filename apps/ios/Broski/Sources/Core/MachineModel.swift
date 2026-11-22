import BroskiCore
import Foundation
import Observation
import os

/// One paired machine as the screens see it. Its event loop runs from `start()` until the core
/// ends the machine's events: forgotten, replaced by a new pairing, or revoked.
@Observable
final class MachineModel: Identifiable {
    let id: String
    let machine: Machine
    let name: String
    let pairedAt: Date
    private(set) var status: MachineStatus
    private(set) var backends: [BackendDescriptor] = []
    private(set) var backendStatuses: [String: BackendStatus] = [:]
    /// Counts the catalog's invalidations: a screen that shows models, commands or modes reads
    /// them again when it changes.
    private(set) var catalogChanges = 0

    @ObservationIgnored private let records: MachineRecordStore
    @ObservationIgnored private var events: Task<Void, Never>?
    /// The core hands over events queued before a forget or a new pairing; a retired model must
    /// not store the old record from them.
    @ObservationIgnored private var isRetired = false

    init(machine: Machine, records: MachineRecordStore) {
        let record = machine.record()
        id = machine.id()
        self.machine = machine
        name = MachineName.display(record.name())
        pairedAt = Date(timeIntervalSince1970: TimeInterval(record.pairedAtMs()) / 1000)
        status = machine.status()
        self.records = records
    }

    var summary: MachineSummary { MachineSummary(name: name, status: status) }

    func descriptor(for backendId: String) -> BackendDescriptor? {
        backends.first { $0.id == backendId }
    }

    /// The agent as this machine's bridge describes it; before it has, as the phone knows it.
    func brand(for backendId: String) -> AgentBrand {
        descriptor(for: backendId).map(AgentBrand.init) ?? AgentBrand(backend: backendId)
    }

    /// The agents the bridge describes, by backend id.
    var brands: [String: AgentBrand] {
        Dictionary(backends.map { ($0.id, AgentBrand($0)) }) { first, _ in first }
    }

    var bridgeVersion: String? {
        if case .ready(let version) = status.contract { version } else { nil }
    }

    /// When the relay last saw the machine, which the relay reports while the machine is away.
    var lastSeen: Date? {
        status.link.lastSeenMs.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000) }
    }

    func start() {
        guard events == nil else { return }
        events = Task { [machine] in
            while let event = await machine.nextEvent() {
                apply(event)
            }
            status = machine.status()
        }
    }

    /// Called when the machine is forgotten or replaced by a new pairing of the same id.
    func retire() {
        isRetired = true
    }

    func persistRecord() {
        guard !isRetired else { return }
        do throws(Keychain.Failure) {
            try records.save(machine.record().toBytes(), id: id)
        } catch {
            Logger.core.error("the record of \(self.id, privacy: .public) was not saved: \(error.status)")
        }
    }

    /// Hands the machine this phone's APNs token; the link session sends it at every connect, so a
    /// machine that is away gets it when it is back.
    func registerPush(_ token: String?) {
        guard let token else { return }
        machine.registerPush(platform: .apns, token: token)
    }

    /// Registers or clears the active iOS Live Activity push token on this machine.
    func registerLiveActivity(_ token: String?) {
        if let token {
            machine.registerLiveActivity(token: token)
        } else {
            machine.unregisterLiveActivity()
        }
    }

    func restartBridge() throws {
        try machine.restartBridge()
    }

    private func apply(_ event: MachineEvent) {
        switch event {
        case .statusChanged(let status):
            self.status = status
        case .recordChanged:
            persistRecord()
        case .backendsChanged(let backends):
            self.backends = backends
            loadBackendStatuses()
        case .backendStatusChanged(let backend, let status):
            backendStatuses[backend] = status
        case .catalogInvalidated:
            catalogChanges += 1
        }
    }

    private func loadBackendStatuses() {
        Task { [machine, backends] in
            for backend in backends {
                if let status = try? await machine.backendStatus(backend: backend.id) {
                    backendStatuses[backend.id] = status
                }
            }
        }
    }
}
