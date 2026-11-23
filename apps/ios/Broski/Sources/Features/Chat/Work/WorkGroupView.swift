import SwiftUI

/// A turn's work as one muted line above its answer, `Worked for 40m · Edited 3 files · Ran 12
/// commands ›` (`WorkGroups`). Opening it adds the turn's rows below it, the stretches of work and
/// the words between them, drawn as they are while a run goes on.
struct WorkGroupView: View {
    let group: WorkGroup
    /// What `Disclosure` keeps its open state under: the row's id, which stays the same when the
    /// run's live rows give way to the transcript's.
    let key: String
    @Environment(Disclosure.self) private var disclosure

    var body: some View {
        WorkSummaryLine(summary: group.summary, isOpen: disclosure.isOpen(key), hint: "Shows every step", identifier: "work.group") {
            disclosure.toggle(key)
        }
    }
}
