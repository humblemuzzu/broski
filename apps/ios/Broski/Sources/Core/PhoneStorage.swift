import BroskiCore
import Foundation

/// What the app keeps between launches: the phone's identity secret and the inbox's seen state in
/// the app's own keychain group, and the machine records in the group the notification service
/// extension shares. Nothing here is ever regenerated on an error.
struct PhoneStorage {
    static let service = "com.muzammil.broski"
    private static let identityAccount = "identity-secret"
    private static let seenAccount = "inbox-seen"

    let app: Keychain
    let records: MachineRecordStore

    init(
        app: Keychain = Keychain(service: service, accessGroup: nil),
        records: MachineRecordStore = MachineRecordStore()
    ) {
        self.app = app
        self.records = records
    }

    func identitySecret() throws(Keychain.Failure) -> Data? {
        try app.data(for: Self.identityAccount)
    }

    func saveIdentitySecret(_ secret: Data) throws(Keychain.Failure) {
        try app.set(secret, for: Self.identityAccount)
    }

    /// The stored seen state; one that no longer decodes is dropped, which costs the person only
    /// the history of a machine showing as seen again at its next first read.
    func seenState() throws(Keychain.Failure) -> SeenState? {
        guard let data = try app.data(for: Self.seenAccount) else { return nil }
        return (try? JSONDecoder().decode(StoredSeenState.self, from: data))?.state
    }

    func saveSeenState(_ state: SeenState) throws(Keychain.Failure) {
        let data = try! JSONEncoder().encode(StoredSeenState(state))
        try app.set(data, for: Self.seenAccount)
    }

    /// Forgets the identity, the seen state and every pairing: only ever on the person's word.
    func removeEverything() throws(Keychain.Failure) {
        for (id, _) in try records.all() {
            try records.remove(id: id)
        }
        try app.remove(Self.seenAccount)
        try app.remove(Self.identityAccount)
    }
}

/// `SeenState` as JSON. Backends are spelled as the contract spells them on the wire.
private struct StoredSeenState: Codable {
    struct Marker: Codable {
        let machineId: String
        let backend: String
        let sessionId: String
        let seenAt: Int64
    }

    let markers: [Marker]
    let readMachines: [String]

    init(_ state: SeenState) {
        markers = state.markers.map {
            Marker(
                machineId: $0.machineId, backend: $0.session.backend.wireName,
                sessionId: $0.session.sessionId, seenAt: $0.seenAt)
        }
        readMachines = state.readMachines
    }

    var state: SeenState {
        SeenState(
            markers: markers.compactMap { marker in
                BackendId(wireName: marker.backend).map {
                    SeenMarker(
                        machineId: marker.machineId,
                        session: SessionRef(backend: $0, sessionId: marker.sessionId),
                        seenAt: marker.seenAt)
                }
            },
            readMachines: readMachines)
    }
}

extension BackendId {
    var wireName: String {
        switch self {
        case .claudeCode: "claude-code"
        case .pi: "pi"
        }
    }

    init?(wireName: String) {
        switch wireName {
        case "claude-code": self = .claudeCode
        case "pi": self = .pi
        default: return nil
        }
    }
}
