import BroskiCore
import Foundation

/// What the app keeps between launches: the phone's identity secret, the inbox's seen state, its
/// last known rows and the pinned sessions in the app's own keychain group, and the machine records
/// in the group the notification service extension shares. Nothing here is ever regenerated on an
/// error.
struct PhoneStorage {
    static let service = "com.muzammil.broski"
    private static let identityAccount = "identity-secret"
    private static let seenAccount = "inbox-seen"
    private static let cacheAccount = "inbox-cache"
    private static let pinnedAccount = "inbox-pinned"

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

    /// The bytes of the core's last `InboxUpdate.cache`, which only the core reads.
    func inboxCache() throws(Keychain.Failure) -> Data? {
        try app.data(for: Self.cacheAccount)
    }

    func saveInboxCache(_ cache: Data) throws(Keychain.Failure) {
        try app.set(cache, for: Self.cacheAccount)
    }

    /// The pinned sessions; a stored list that no longer decodes, or a backend that is no valid id,
    /// is dropped.
    func pinnedSessions() throws(Keychain.Failure) -> Set<SessionTarget> {
        guard let data = try app.data(for: Self.pinnedAccount),
            let stored = try? JSONDecoder().decode([StoredSession].self, from: data)
        else { return [] }
        return Set(stored.compactMap(\.target))
    }

    func savePinnedSessions(_ sessions: Set<SessionTarget>) throws(Keychain.Failure) {
        let data = try! JSONEncoder().encode(sessions.map(StoredSession.init))
        try app.set(data, for: Self.pinnedAccount)
    }

    /// Forgets the identity, the seen state, the cached inbox, the pins and every pairing: only ever
    /// on the person's word.
    func removeEverything() throws(Keychain.Failure) {
        for (id, _) in try records.all() {
            try records.remove(id: id)
        }
        try app.remove(Self.pinnedAccount)
        try app.remove(Self.cacheAccount)
        try app.remove(Self.seenAccount)
        try app.remove(Self.identityAccount)
    }
}

/// One session on one machine as JSON, its backend as the contract spells it on the wire.
private struct StoredSession: Codable {
    let machineId: String
    let backend: String
    let sessionId: String

    init(_ target: SessionTarget) {
        machineId = target.machineId
        backend = target.session.backend
        sessionId = target.session.sessionId
    }

    var target: SessionTarget? { SessionTarget(machineId: machineId, backend: backend, sessionId: sessionId) }
}

/// `SeenState` as JSON. A marker or an unread mark whose backend is no valid id is dropped; a
/// state stored before unread marks existed reads as having none.
private struct StoredSeenState: Codable {
    struct Marker: Codable {
        let machineId: String
        let backend: String
        let sessionId: String
        let seenAt: Int64
    }

    let markers: [Marker]
    let readMachines: [String]
    let unread: [StoredSession]?

    init(_ state: SeenState) {
        markers = state.markers.map {
            Marker(
                machineId: $0.machineId, backend: $0.session.backend,
                sessionId: $0.session.sessionId, seenAt: $0.seenAt)
        }
        readMachines = state.readMachines
        unread = state.unread.map { StoredSession(SessionTarget(machineId: $0.machineId, session: $0.session)) }
    }

    var state: SeenState {
        SeenState(
            markers: markers.filter { Slug.isValid($0.backend) }.map {
                SeenMarker(
                    machineId: $0.machineId,
                    session: SessionRef(backend: $0.backend, sessionId: $0.sessionId),
                    seenAt: $0.seenAt)
            },
            readMachines: readMachines,
            unread: (unread ?? []).compactMap(\.target).map { UnreadSession(machineId: $0.machineId, session: $0.session) })
    }
}
