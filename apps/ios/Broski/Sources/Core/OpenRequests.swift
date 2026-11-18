import BroskiCore

/// A session on one machine that something outside the inbox (a notification, a Live Activity)
/// asks to show.
struct SessionTarget: Hashable {
    let machineId: String
    let session: SessionRef
}
