package com.muzammil.broski.feature.chat.transcript

/**
 * Whether the transcript follows its end, and what arrived while it did not. Only the person's own
 * scrolling detaches it: a send or an answer never moves a reader.
 */
data class Follow(val following: Boolean = true, val unseen: Int = 0) {
    fun scrolled(atEnd: Boolean): Follow = if (atEnd) Follow() else copy(following = false)

    fun arrived(messages: Int): Follow = if (following || messages == 0) this else copy(unseen = unseen + messages)

    fun jumped(): Follow = Follow()
}

/** Messages in [after] that [before] lacked: the person's, and each text block of an answer. */
fun newMessages(before: List<ChatRow>, after: List<ChatRow>): Int {
    val known = before.mapTo(HashSet()) { it.key }
    return after.count { row ->
        row.key !in known && (row is ChatRow.User || row is ChatRow.Text)
    }
}
