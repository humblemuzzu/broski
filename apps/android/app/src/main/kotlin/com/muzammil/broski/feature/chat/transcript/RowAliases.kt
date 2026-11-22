package com.muzammil.broski.feature.chat.transcript

/**
 * When a run ends, the transcript's newest page replaces its live rows. Backends such as Pi assign
 * transcript ids only once persisted, so the transcript's keys differ from the live run's keys.
 * Walking the live run and the transcript side-by-side from the person's message (`c:<requestId>`)
 * maps each transcript row back to its live key so opened folds and disclosures survive run end.
 */
object RowAliases {
    private enum class Kind {
        Message, Work, Text, CopyAnswer, Note, Activity, Older;

        val isTranscriptOnly: Boolean get() = this == Note
    }

    fun learn(live: List<ChatRow>, history: List<ChatRow>, aliases: MutableMap<String, String>) {
        val start = live.indexOfFirst { it is ChatRow.User }
        if (start < 0) return
        val match = history.indexOfFirst { it.key == live[start].key }
        if (match < 0) return
        val taken = history.mapTo(HashSet()) { aliases[it.key] ?: it.key }
        var liveIndex = start
        var historyIndex = match
        while (liveIndex < live.size && historyIndex < history.size) {
            val mine = live[liveIndex]
            val theirs = history[historyIndex]
            val myKind = mine.kind()
            val theirKind = theirs.kind()
            if (myKind == theirKind) {
                if (mine.key != theirs.key && theirs.key !in aliases && mine.key !in taken) {
                    aliases[theirs.key] = mine.key
                    taken += mine.key
                }
                liveIndex += 1
                historyIndex += 1
            } else if (theirKind.isTranscriptOnly) {
                historyIndex += 1
            } else {
                liveIndex += 1
            }
        }
    }

    fun apply(rows: List<ChatRow>, aliases: Map<String, String>): List<ChatRow> {
        if (aliases.isEmpty()) return rows
        return rows.map { row -> aliases[row.key]?.let { row.rekey(it) } ?: row }
    }

    private fun ChatRow.kind(): Kind = when (this) {
        is ChatRow.User -> Kind.Message
        is ChatRow.Work -> Kind.Work
        is ChatRow.Text -> Kind.Text
        is ChatRow.CopyAnswer -> Kind.CopyAnswer
        is ChatRow.Note -> Kind.Note
        is ChatRow.Activity -> Kind.Activity
        is ChatRow.Older -> Kind.Older
    }

    private fun ChatRow.rekey(newKey: String): ChatRow = when (this) {
        is ChatRow.User -> copy(key = newKey)
        is ChatRow.Text -> copy(key = newKey)
        is ChatRow.CopyAnswer -> copy(key = newKey)
        is ChatRow.Work -> copy(key = newKey)
        is ChatRow.Note -> copy(key = newKey)
        is ChatRow.Activity -> copy(key = newKey)
        is ChatRow.Older -> copy(key = newKey)
    }
}
