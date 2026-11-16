import BroskiCore

/// An activity with how it reads (its tone, facts, preview and log clip), read once when its row
/// is built rather than each time the row is drawn.
nonisolated struct ActivityEntry: Equatable {
    let item: ActivityItem
    let look: ActivityLook

    init(_ item: ActivityItem) {
        self.item = item
        look = activityLook(activity: item.activity)
    }

    var id: String { item.id }
}
