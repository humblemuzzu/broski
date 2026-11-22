package com.muzammil.broski.feature.chat.transcript

/**
 * Whether the transcript follows its end, and what arrived while it did not. Only the person's own
 * upward scrolling changes it; rows arriving under a resting finger never detach a follower.
 */
data class Follow(val following: Boolean = true, val unseen: Int = 0) {
    fun dragged(travelledPx: Int, distanceFromEnd: Int, detachPx: Int): Follow =
        if (following && travelledPx > detachPx && distanceFromEnd > detachPx) copy(following = false) else this

    fun settled(distanceFromEnd: Int, followPx: Int): Follow = if (distanceFromEnd <= followPx) Follow() else this

    fun arrived(messages: Int): Follow = if (following || messages == 0) this else copy(unseen = unseen + messages)

    fun jumped(): Follow = Follow()
}

fun newMessages(before: List<ChatRow>, after: List<ChatRow>): Int {
    val known = before.mapTo(HashSet()) { it.key }
    return after.count { row ->
        row.key !in known && (row is ChatRow.User || (row is ChatRow.Text && row.first))
    }
}
