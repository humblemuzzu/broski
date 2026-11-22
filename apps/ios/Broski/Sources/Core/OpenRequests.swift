import BroskiCore
import Foundation

/// A session on one machine that something outside the inbox (a notification, a Live Activity)
/// asks to show.
struct SessionTarget: Hashable {
    let machineId: String
    let session: SessionRef
}

extension SessionTarget {
    /// From the ids a link, a push or the Live Activity carries; nil for a backend that is no
    /// valid id.
    init?(machineId: String, backend: String, sessionId: String) {
        guard Slug.isValid(backend) else { return nil }
        self.init(machineId: machineId, session: SessionRef(backend: backend, sessionId: sessionId))
    }

    /// `broski://session?machine=…&backend=…&session=…`, the Live Activity's link; the first of a
    /// repeated name counts.
    init?(url: URL) {
        guard url.scheme == "broski", url.host() == "session",
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        else { return nil }
        let values = Dictionary(items.compactMap { item in item.value.map { (item.name, $0) } }) { first, _ in first }
        guard let machineId = values["machine"], let backend = values["backend"], let sessionId = values["session"]
        else { return nil }
        self.init(machineId: machineId, backend: backend, sessionId: sessionId)
    }
}
