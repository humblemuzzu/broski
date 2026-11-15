import CoreGraphics

/// Whether the transcript follows its end (design.md, "Scrolling is a follow-or-detach state
/// machine"). Following while the end is within a point; detached the moment the person scrolls
/// away; back to following when they scroll to the end themselves or jump. Content growing,
/// answering and sending never change it: only the person's scrolling and the jump do.
struct FollowState: Equatable {
    enum Mode: Equatable {
        case following
        case detached
    }

    private(set) var mode: Mode = .following
    /// Messages that arrived below a detached reader.
    private(set) var unseen = 0

    static let endTolerance: CGFloat = 1

    var isFollowing: Bool { mode == .following }

    /// The scroll view moved: `distanceFromEnd` points above its end, `byPerson` when a finger or
    /// its momentum moved it (not content changing size or a programmatic scroll).
    mutating func scrolled(distanceFromEnd: CGFloat, byPerson: Bool) {
        if distanceFromEnd <= Self.endTolerance {
            follow()
        } else if byPerson {
            mode = .detached
        }
    }

    /// New messages arrived at the end.
    mutating func appended(messages: Int) {
        guard mode == .detached, messages > 0 else { return }
        unseen += messages
    }

    /// The person tapped "Jump to latest".
    mutating func jumped() {
        follow()
    }

    private mutating func follow() {
        mode = .following
        unseen = 0
    }
}
