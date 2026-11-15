import BroskiCore

/// A session on one machine that something outside the inbox (a notification, a Live Activity)
/// asks to show.
struct SessionTarget: Hashable {
    let machineId: String
    let session: SessionRef
}

/// A folder on one machine that another screen (the chat's "Open folder in Files") asks the
/// Workspace tab to show.
struct FolderTarget: Hashable {
    let machineId: String
    let path: String
}
