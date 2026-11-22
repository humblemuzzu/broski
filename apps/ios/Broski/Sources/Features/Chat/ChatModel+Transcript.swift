import BroskiCore
import Foundation
import os

/// Transcript pagination, history/live row projection, and smooth streaming pacing for `ChatModel`.
extension ChatModel {
    /// Reads the newest page; an answer to an earlier read that comes after a later one's is dropped,
    /// since it may not hold the run that just ended.
    func loadNewest() async {
        let session = session
        newestReads += 1
        let read = newestReads
        let limit = history.isLoaded ? TranscriptHistory.pageSize : TranscriptHistory.firstPageSize
        do throws(ChatProblem) {
            let page = try await requests.transcript(session, cursor: nil, limit: limit)
            guard session == self.session, read == newestReads else { return }
            history.setNewest(page)
            settling = []
            historyProblem = nil
            newestFailures = 0
        } catch {
            Logger.core.error("the transcript was not read: \(error.message, privacy: .public)")
            guard read == newestReads else { return }
            historyProblem = error
            olderFailed = false
            if error.code == nil { readNewestLater() }
        }
        retireDelivered(history.deliveredRequests)
        bindConfirmedImages(in: history.items)
        rebuildHistory()
        revealIfReady()
    }

    func readNewestLater() {
        let pause = newestRetryPause(newestFailures)
        newestFailures += 1
        newestRetry?.cancel()
        newestRetry = Task { [weak self] in
            try? await Task.sleep(for: pause)
            guard !Task.isCancelled, let self, pull != nil else { return }
            await loadNewest()
        }
    }

    func loadOlder() async {
        guard let cursor = history.olderCursor, !isLoadingOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do throws(ChatProblem) {
            history.addOlder(try await requests.transcript(session, cursor: cursor, limit: TranscriptHistory.pageSize))
            rebuildHistory()
        } catch {
            historyProblem = error
            olderFailed = true
        }
    }

    func loadOlderIfNeeded() {
        guard isRevealed, history.hasOlder, historyProblem == nil, !isLoadingOlder else { return }
        Task { await loadOlder() }
    }

    func retryHistory() {
        historyProblem = nil
        Task {
            if olderFailed { await loadOlder() } else { await loadNewest() }
        }
    }

    func recentItems(limit: Int = 80) -> [TranscriptItem] {
        Array((history.items + settling + (snapshot.run?.items ?? [])).suffix(limit))
    }

    /// Rebuilds finished transcript rows. Rows of a run that just ended keep the ids their live
    /// rows had, so disclosures stay open across run-end reconciliation.
    func rebuildHistory() {
        var timeline = ChatTimeline(atStart: !history.hasOlder)
        timeline.add(history.items)
        timeline.close(live: false)
        let rows = timeline.rows
        RowAliases.learn(live: liveRows, history: rows, into: &rowAliases)
        historyRows = rowAliases.isEmpty ? rows : rows.map { row in
            rowAliases[row.id].map { ChatRow(id: $0, content: row.content, gap: row.gap) } ?? row
        }
        rebuildLive(arriving: false)
    }

    func rebuildLive(arriving: Bool = true) {
        let previous = historyRows.last
        var timeline = ChatTimeline(after: previous)
        timeline.add(settling)
        let pacedBlocks = pacer.sync(snapshot.blocks, animated: arriving && isRevealed && follow.isFollowing)
        if let run = snapshot.run {
            timeline.addLive(items: run.items, blocks: pacedBlocks, tools: snapshot.tools)
        }
        timeline.close(live: isRunning)
        for prompt in pending { timeline.append(pending: prompt) }
        let rows = timeline.finished(continuing: previous)
        updateFollow { $0.appended(messages: rows.count(where: \.startsMessage) - liveRows.count(where: \.startsMessage)) }
        let existingIDs = Set(liveRows.map(\.id))
        let currentIDs = Set(rows.map(\.id))
        freshRowIDs.formIntersection(currentIDs)
        if arriving {
            for row in rows where row.risesIn && !existingIDs.contains(row.id) {
                freshRowIDs.insert(row.id)
            }
        }
        liveRows = rows
    }

    func bindConfirmedImages(in items: [TranscriptItem]) {
        for item in items {
            if case .userMessage(let message) = item, let requestId = message.clientRequestId, !message.attachments.isEmpty {
                imageStore.bindConfirmed(requestId: requestId, attachments: message.attachments)
            }
        }
    }

    func retireDelivered(_ delivered: Set<String>) {
        guard !delivered.isEmpty else { return }
        pending.removeAll { delivered.contains($0.id) }
    }

    func retire(_ id: String) {
        pending.removeAll { $0.id == id }
        rebuildLive(arriving: false)
    }

    func revealIfReady() {
        guard !isRevealed, state.session != nil, history.isLoaded || historyProblem != nil else { return }
        isRevealed = true
    }
}
