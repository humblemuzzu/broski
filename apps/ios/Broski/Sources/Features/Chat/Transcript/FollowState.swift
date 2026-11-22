import CoreGraphics

/// Whether the transcript follows its end. Only the person's own scrolling changes it: a drag that
/// moves the view more than `detachDistance` toward older messages, leaving the end at least as far
/// away, detaches; a scroll that comes to rest within
/// `followDistance` of the end, or a jump, follows again. Content growing, a bar changing height and
/// a page loading never change it, so nothing but a finger can leave the end, and resting near the
/// end is the end.
struct FollowState: Equatable {
    enum Mode: Equatable {
        case following
        case detached
    }

    private(set) var mode: Mode = .following
    /// Messages that arrived below a detached reader.
    private(set) var unseen = 0

    static let detachDistance: CGFloat = 24
    static let followDistance: CGFloat = 48

    var isFollowing: Bool { mode == .following }

    /// A finger (or its momentum) moved the view `travelled` points toward older messages since it
    /// touched down, and the end is `distanceFromEnd` points below the view. Content growing under a
    /// resting finger moves the end, not the view, so it never detaches.
    mutating func dragged(travelled: CGFloat, distanceFromEnd: CGFloat) {
        if travelled > Self.detachDistance && distanceFromEnd > Self.detachDistance { mode = .detached }
    }

    /// The person's scroll came to rest `distanceFromEnd` points above the end.
    mutating func settled(distanceFromEnd: CGFloat) {
        if distanceFromEnd <= Self.followDistance { follow() }
    }

    /// New messages arrived at the end.
    mutating func appended(messages: Int) {
        guard mode == .detached, messages > 0 else { return }
        unseen += messages
    }

    /// The person jumped to the end, or sent something.
    mutating func jumped() {
        follow()
    }

    private mutating func follow() {
        mode = .following
        unseen = 0
    }
}
