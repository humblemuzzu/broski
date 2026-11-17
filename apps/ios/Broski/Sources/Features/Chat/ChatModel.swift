import BroskiCore
import Foundation
import Observation
import UIKit
import os

/// One open chat: the session view's state as the core hands it over, the finished runs read from
/// the transcript, the rows both make, and what the person has sent that has not landed yet. The
/// view stays attached while the chat is on screen, which is also what lets the bridge take its
/// prompts and stops (contract §12.1).
@Observable
final class ChatModel {
    let machineId: String
    private(set) var session: SessionRef
    private(set) var state = SessionState()
    private(set) var history = TranscriptHistory()
    private(set) var historyRows: [ChatRow] = []
    private(set) var liveRows: [ChatRow] = []
    private(set) var pending: [PendingPrompt] = []
    private(set) var notices: [ChatNotice] = []
    /// The session's row as `session.get` gave it: its title and folder.
    private(set) var summary: SessionSummary?
    /// The title the person gave here, shown for the rest of the visit whatever the row says.
    private(set) var renamedTitle: String?
    private(set) var historyProblem: ChatProblem?
    private(set) var isLoadingOlder = false
    /// False until the newest page and the live state are both in (or a short wait passed), so the
    /// transcript never builds itself in front of the person.
    private(set) var isRevealed = false
    private(set) var follow = FollowState()
    var draft: ComposerDraft {
        didSet { drafts[target] = draft }
    }
    /// The interactions whose answers are on their way, and what came of each answered one.
    private(set) var answering: Set<String> = []
    private(set) var answerProblems: [String: ChatProblem] = [:]
    /// Bumped by every send, answer and stop, for the haptics they play.
    private(set) var feedback: ChatFeedback?

    @ObservationIgnored let requests: ChatRequests
    @ObservationIgnored private let attach: (SessionRef) throws -> SessionView
    @ObservationIgnored private let drafts: DraftStore
    /// The items of a run that ended, and activities outside any run, shown until the transcript's
    /// newest page holds them.
    @ObservationIgnored private var settling: [TranscriptItem] = []
    @ObservationIgnored private var firstPrompt: ComposerDraft?
    /// When each live row that rises in was first built.
    @ObservationIgnored private var births: [String: Date] = [:]
    @ObservationIgnored private var pull: Task<Void, Never>?
    @ObservationIgnored private var images: [String: UIImage] = [:]
    @ObservationIgnored private var newestReads = 0
    @ObservationIgnored private var newestRetry: Task<Void, Never>?
    @ObservationIgnored private var newestFailures = 0
    /// The pause before reading the newest page again after this many failed reads in a row.
    @ObservationIgnored var newestRetryPause: (Int) -> Duration = { .seconds(min(30, 1 << min($0, 5))) }

    static let revealWait: Duration = .milliseconds(1200)

    init(
        target: SessionTarget, requests: ChatRequests, drafts: DraftStore, firstPrompt: ComposerDraft? = nil,
        attach: @escaping (SessionRef) throws -> SessionView
    ) {
        machineId = target.machineId
        session = target.session
        self.requests = requests
        self.drafts = drafts
        self.attach = attach
        self.firstPrompt = firstPrompt
        draft = drafts[target]
    }

    var target: SessionTarget { SessionTarget(machineId: machineId, session: session) }
    var snapshot: SessionSnapshot { state.snapshot }
    var isRunning: Bool { state.isRunning }
    var interactions: [Interaction] { snapshot.interactions }
    var canControl: Bool { state.capabilities?.controllable ?? false }
    var canAnswer: Bool { state.capabilities?.answer ?? false }
    /// Why the live view stopped; until `reattach`, nothing live reaches this chat.
    var viewEnd: ViewEnd? { state.ended }
    /// False while the view attaches again after the link or the bridge came back.
    var isLive: Bool { state.isLive }

    /// Attaches the view and pulls it for as long as the chat lives. The stack keeps a chat alive
    /// while a diff or another session is pushed over it; its end cancels the pull, and the
    /// cancellation detaches the view, which is what ends a Swift pull (mobile-packaging.md §1).
    func start() {
        guard pull == nil else { return }
        let view: SessionView
        do {
            view = try attach(session)
        } catch {
            notices.append(ChatNotice(ChatProblem(error)))
            isRevealed = true
            return
        }
        Task { [weak self] in
            try? await Task.sleep(for: Self.revealWait)
            self?.isRevealed = true
        }
        Task { await loadNewest() }
        pull = Task { [weak self] in
            await withTaskCancellationHandler {
                while let update = await view.nextUpdate() {
                    guard let self else { return }
                    self.apply(update)
                }
            } onCancel: {
                view.detach()
            }
        }
    }

    deinit {
        pull?.cancel()
        newestRetry?.cancel()
    }

    /// A new view in place of one the bridge refused: the refusal may have been passing (an agent
    /// that failed to start, a Mac that was busy), and the old view never attaches again.
    func reattach() {
        pull?.cancel()
        pull = nil
        state = SessionState()
        start()
    }

    func apply(_ update: SessionUpdate) {
        let before = state.snapshot.lastOutcome
        let previous = session
        let wasAttached = state.session != nil
        for moment in state.apply(update) {
            handle(moment)
        }
        if case .changes = update, state.snapshot.lastOutcome != before, let outcome = state.snapshot.lastOutcome,
            let notice = ChatNotice(outcome: outcome)
        {
            notices.append(notice)
        }
        if let replaced = state.session, replaced != previous {
            session = replaced
            history = TranscriptHistory()
            historyRows = []
            Task { await loadNewest() }
        } else if case .reset = update, wasAttached {
            // The view started over after a gap the bridge could not replay: runs may have begun and
            // ended meanwhile, and only the transcript has them.
            Task { await loadNewest() }
        }
        retireDelivered(state.snapshot.run?.items.deliveredRequests ?? [])
        if case .changes = update { rebuildLive() } else { rebuildLive(arriving: false) }
        if case .ended = update { isRevealed = true }
        revealIfReady()
        sendFirstPromptIfReady()
    }

    private func handle(_ moment: SessionMoment) {
        switch moment {
        case .notice(let notice): notices.append(ChatNotice(notice, transcribed: true))
        case .activity(let item): settling.append(.activity(item))
        case .error(let error): notices.append(ChatNotice(error))
        case .rateLimit(let update): if let notice = ChatNotice(rateLimit: update) { notices.append(notice) }
        case .inputReturned(let texts): draft.prepend(returned: texts)
        case .runEnded(let items):
            notices.removeAll { $0.tone == .info && $0.isTranscribed }
            settling += items
            Task { await loadNewest() }
        }
    }

    func dismiss(_ notice: ChatNotice) {
        notices.removeAll { $0.id == notice.id }
    }

    func report(_ problem: ChatProblem) {
        notices.append(ChatNotice(problem))
        play(.failed)
    }

    func play(_ moment: HapticMoment) {
        feedback = ChatFeedback(moment)
    }

    func adopt(_ summary: SessionSummary) {
        guard summary.session == session else { return }
        self.summary = summary
    }

    func rename(to title: String) async {
        let title = title.trimmed
        guard !title.isEmpty else { return }
        do throws(ChatProblem) {
            try await requests.rename(session, to: title)
            renamedTitle = title
        } catch {
            report(error)
        }
    }

    /// An image a message names, read back from the Mac once and kept while the chat is open.
    func image(_ ref: ImageRef) async -> UIImage? {
        if let known = images[ref.id] { return known }
        guard let read = try? await requests.attachment(session, id: ref.id),
            let data = Data(base64Encoded: read.data), let image = UIImage(data: data)
        else { return nil }
        images[ref.id] = image
        return image
    }

    // MARK: Transcript

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
            if error.code == nil { readNewestLater() }
        }
        retireDelivered(history.deliveredRequests)
        rebuildHistory()
        revealIfReady()
    }

    /// A read that got no answer goes again by itself while the chat is open, after a pause that
    /// grows; the problem stays shown until a read lands.
    private func readNewestLater() {
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
        }
    }

    private func rebuildHistory() {
        var timeline = ChatTimeline()
        timeline.add(history.items)
        timeline.close(live: false)
        historyRows = timeline.rows
        rebuildLive()
    }

    /// - Parameter arriving: whether rows new to the live part arrive now (and rise in), or were
    ///   there already when the view started over.
    private func rebuildLive(arriving: Bool = true) {
        let previous = historyRows.last
        var timeline = ChatTimeline(after: previous)
        timeline.add(settling)
        if let run = snapshot.run {
            timeline.addLive(items: run.items, blocks: snapshot.blocks, tools: snapshot.tools)
        }
        timeline.close(live: isRunning)
        for prompt in pending { timeline.append(pending: prompt) }
        let rows = timeline.finished(continuing: previous)
        updateFollow { $0.appended(messages: rows.count(where: \.startsMessage) - liveRows.count(where: \.startsMessage)) }
        let now = Date.now
        let ids = Set(rows.map(\.id))
        births = births.filter { ids.contains($0.key) }
        for row in rows where row.risesIn && births[row.id] == nil { births[row.id] = arriving ? now : .distantPast }
        liveRows = rows
    }

    /// The transcript reports its scrolling from inside layout, and that layout reads `follow`. A
    /// mutation in place (`follow.scrolled(…)`) announces a change even when nothing changed, and
    /// UIKit lays the whole app out again for each one: that spun the layout every frame, freezing
    /// the app with the chat half pushed and its transcript never shown. So the new value is worked
    /// out on a copy and assigned only when it differs.
    func updateFollow(_ change: (inout FollowState) -> Void) {
        var next = follow
        change(&next)
        if next != follow { follow = next }
    }

    /// A live row built within the last three seconds, which rises in when it appears.
    func isFresh(_ row: ChatRow) -> Bool {
        births[row.id].map { Date.now.timeIntervalSince($0) < 3 } ?? false
    }

    private func revealIfReady() {
        guard !isRevealed, state.session != nil, history.isLoaded || historyProblem != nil else { return }
        isRevealed = true
    }

    // MARK: Sending

    /// Sends what the draft holds the way `action` says; the person's bubble shows at once, dimmed
    /// until the agent shows it delivered. A refused prompt goes back into the field.
    func send(_ action: SendAction) async {
        guard let mode = action.mode, draft.hasContent else { return }
        let sent = draft
        draft = ComposerDraft()
        await deliver(sent, mode: mode)
    }

    private func deliver(_ sent: ComposerDraft, mode: PromptMode) async {
        let input = sent.input(mode: mode)
        pending.append(PendingPrompt(id: input.clientRequestId, draft: sent))
        rebuildLive()
        feedback = ChatFeedback(.sent)
        do throws(ChatProblem) {
            let accepted = try await requests.prompt(session, input)
            if accepted.disposition == .queued || accepted.disposition == .handled {
                retire(input.clientRequestId)
            }
        } catch {
            retire(input.clientRequestId)
            draft = sent.merged(before: draft)
            notices.append(ChatNotice(error))
            feedback = ChatFeedback(.failed)
            Logger.core.error("a prompt was refused: \(error.message, privacy: .public)")
        }
    }

    /// A new session's first prompt goes once the view is attached, which the bridge requires.
    private func sendFirstPromptIfReady() {
        guard let firstPrompt, state.session != nil else { return }
        self.firstPrompt = nil
        Task { await deliver(firstPrompt, mode: .start) }
    }

    private func retireDelivered(_ delivered: Set<String>) {
        guard !delivered.isEmpty else { return }
        pending.removeAll { delivered.contains($0.id) }
    }

    private func retire(_ id: String) {
        pending.removeAll { $0.id == id }
        rebuildLive()
    }

    func stop() async {
        feedback = ChatFeedback(.stopped)
        do throws(ChatProblem) {
            try await requests.abort(session)
        } catch {
            notices.append(ChatNotice(error))
        }
    }

    func cancelQueued(_ item: QueueItem) async {
        do throws(ChatProblem) {
            try await requests.cancelQueued(session, id: item.id)
            feedback = ChatFeedback(.destructive)
        } catch {
            notices.append(ChatNotice(error))
        }
    }

    // MARK: Answers

    /// Sends exactly the reply the person chose. The card stays until the bridge withdraws the ask
    /// (`InteractionRemoved`); a refusal as stale says another answer got there first.
    func answer(_ interaction: Interaction, _ reply: InteractionReply) async {
        guard answering.insert(interaction.id).inserted else { return }
        defer { answering.remove(interaction.id) }
        answerProblems[interaction.id] = nil
        do throws(ChatProblem) {
            try await requests.answer(session, InteractionAnswer(interactionId: interaction.id, reply: reply))
            feedback = ChatFeedback(interaction.isRefusal(reply) ? .destructive : .confirmed)
        } catch {
            answerProblems[interaction.id] = error
            feedback = ChatFeedback(error.isStale ? .destructive : .failed)
        }
    }
}

