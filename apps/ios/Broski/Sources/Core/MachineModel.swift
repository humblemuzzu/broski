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
    private(set) var backendStatuses: [BackendId: BackendStatus] = [:]

    @ObservationIgnored private let records: MachineRecordStore
    @ObservationIgnored private var events: Task<Void, Never>?

    init(machine: Machine, records: MachineRecordStore) {
        let record = machine.record()
        id = machine.id()
        self.machine = machine
        name = record.name()
        pairedAt = Date(timeIntervalSince1970: TimeInterval(record.pairedAtMs()) / 1000)
        status = machine.status()
        self.records = records
    }

    var summary: MachineSummary { MachineSummary(name: name, status: status) }

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

    func persistRecord() {
        do throws(Keychain.Failure) {
            try records.save(machine.record().toBytes(), id: id)
        } catch {
            Logger.core.error("the record of \(self.id, privacy: .public) was not saved: \(error.status)")
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
            break
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
