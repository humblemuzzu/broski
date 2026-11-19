import AVFAudio
import BroskiCore
import Foundation
import Observation
import UIKit
import os

/// The app's one dictation, for whichever composer started it: hold the mic to talk and let go to
/// insert, or tap it to start and tap ✓ to insert. The recording goes to xAI with the session's
/// names; with no key, or no connection, this iPhone's recognizer transcribes it instead.
@Observable
final class Dictation {
    enum Phase: Equatable {
        case idle
        /// `held` while the finger stays on the mic; `cancelling` while it has slid away.
        case recording(held: Bool, cancelling: Bool)
        case transcribing(onDevice: Bool)
        case failed(DictationProblem)
    }

    /// A press shorter than this starts a recording that goes on without the finger.
    static let tapLength: TimeInterval = 0.35
    /// A recording shorter than this is a slip, not speech.
    static let shortest: TimeInterval = 0.5
    static let levelCount = 48

    private(set) var phase: Phase = .idle
    /// The composer the phase belongs to.
    private(set) var owner: String?
    /// The loudness of the last few seconds, newest last.
    private(set) var levels: [Float] = []
    private(set) var startedAt: Date?
    private(set) var notice: DictationNotice?
    private(set) var feedback: ChatFeedback?
    /// The composer that plays `feedback`.
    private(set) var feedbackOwner: String?

    @ObservationIgnored let glance = WorkspaceGlance()
    @ObservationIgnored private let recorder = DictationRecorder()
    @ObservationIgnored private let keys = VoiceKeyStore()
    @ObservationIgnored private var target: DictationTarget?
    @ObservationIgnored private var file: URL?
    @ObservationIgnored private var sources: Task<DictationSources, Never>?
    @ObservationIgnored private var metering: Task<Void, Never>?
    @ObservationIgnored private var work: Task<Void, Never>?
    @ObservationIgnored private var finishOnRelease = false
    /// The finger holding the mic, watched for the lift the mic's view may not hear.
    @ObservationIgnored private var touch: (touch: UITouch, start: CGPoint)?
    @ObservationIgnored private var background = UIBackgroundTaskIdentifier.invalid

    init() {
        DictationRecorder.removeLeftovers()
        recorder.stoppedByItself = { [weak self] in self?.finish() }
    }

    func phase(for id: String) -> Phase { owner == id ? phase : .idle }

    func notice(for id: String) -> DictationNotice? { notice?.owner == id ? notice : nil }

    /// Another composer's dictation is under way, so this one's mic waits.
    func isBusy(apartFrom id: String) -> Bool { owner != nil && owner != id && !isFailed }

    /// True while recording or transcribing on screen, so the display never dims mid-sentence.
    var isKeepingScreenAwake: Bool {
        switch phase {
        case .recording, .transcribing: true
        case .idle, .failed: false
        }
    }

    private var isFailed: Bool { if case .failed = phase { true } else { false } }

    // MARK: The mic's gesture

    /// The finger went down on `target`'s mic. Synchronous, so the release that follows always
    /// finds the recording it started.
    func press(_ target: DictationTarget, touch: UITouch? = nil) {
        finishOnRelease = false
        self.touch = touch.map { ($0, $0.location(in: nil)) }
        if isFailed, owner != target.id { discard() }
        switch phase(for: target.id) {
        case .recording(held: false, _):
            finishOnRelease = true
            return
        case .recording, .transcribing:
            return
        case .failed:
            discard()
        case .idle:
            break
        }
        guard !isBusy(apartFrom: target.id) else { return }
        switch DictationRecorder.permission {
        case .granted:
            start(target)
        case .undetermined:
            Task {
                let granted = await DictationRecorder.requestPermission()
                show(granted ? .microphoneReady : nil, for: target.id)
                if !granted { fail(.microphoneDenied, owner: target.id) }
            }
        default:
            fail(.microphoneDenied, owner: target.id)
        }
    }

    /// The finger slid away from the mic far enough to cancel on release, or came back.
    func slide(cancelling: Bool) {
        guard case .recording(held: true, let was) = phase, was != cancelling else { return }
        phase = .recording(held: true, cancelling: cancelling)
    }

    /// The finger lifted after `held` seconds on the mic.
    func release(held: TimeInterval) {
        if finishOnRelease {
            finishOnRelease = false
            finish()
            return
        }
        guard case .recording(held: true, let cancelling) = phase else { return }
        if cancelling {
            cancel()
        } else if held < Self.tapLength {
            phase = .recording(held: false, cancelling: false)
        } else {
            finish()
        }
    }

    /// The held finger as UIKit sees it: slid away, or lifted.
    private func followTouch() {
        guard case .recording(held: true, _) = phase, let held = touch else { return }
        switch held.touch.phase {
        case .ended, .cancelled:
            touch = nil
            release(held: startedAt.map { Date.now.timeIntervalSince($0) } ?? 0)
        default:
            slide(cancelling: held.start.x - held.touch.location(in: nil).x > MicButton.cancelDistance)
        }
    }

    // MARK: Recording

    private func start(_ target: DictationTarget) {
        do {
            file = try recorder.start()
        } catch {
            Logger.core.error("the recording did not start: \(error.localizedDescription, privacy: .public)")
            fail(DictationProblem(message: "The microphone didn't start. Try again.", detail: error.localizedDescription, fix: .none), owner: target.id)
            return
        }
        self.target = target
        owner = target.id
        notice = nil
        levels = []
        startedAt = .now
        phase = .recording(held: true, cancelling: false)
        play(.listening, for: target.id)
        sources = Task { await target.sources() }
        metering = Task { [weak self] in
            while !Task.isCancelled, let self, case .recording = self.phase {
                self.levels.append(self.recorder.level())
                if self.levels.count > Self.levelCount { self.levels.removeFirst(self.levels.count - Self.levelCount) }
                self.followTouch()
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    /// Stops the recording and transcribes it; a slip shorter than `shortest` is dropped.
    func finish() {
        guard case .recording = phase, let owner else { return }
        metering?.cancel()
        let elapsed = startedAt.map { Date.now.timeIntervalSince($0) } ?? 0
        guard let url = recorder.stop() else {
            reset()
            return
        }
        file = url
        guard elapsed >= Self.shortest else {
            discard()
            show(.tooShort, for: owner)
            return
        }
        play(.stopped, for: owner)
        transcribe()
    }

    /// Stops whatever is under way and throws the recording away.
    func cancel() {
        guard let owner else { return }
        if case .recording = phase { recorder.cancel() }
        work?.cancel()
        play(.destructive, for: owner)
        discard()
    }

    func retry() {
        guard case .failed(let problem) = phase, problem.fix == .retry, file != nil else { return }
        transcribe()
    }

    /// Forgets a failed or finished dictation and its recording.
    func discard() {
        if let file { try? FileManager.default.removeItem(at: file) }
        reset()
    }

    /// The composer `id` left the screen: its recording ends there and is transcribed into its draft.
    func composerLeft(_ id: String) {
        guard owner == id, case .recording = phase else { return }
        finish()
    }

    /// The app left the screen: a recording ends there and is transcribed in the time iOS gives.
    func sceneLeft() {
        if case .recording = phase { finish() }
    }

    private func reset() {
        metering?.cancel()
        sources?.cancel()
        work = nil
        target = nil
        file = nil
        owner = nil
        levels = []
        startedAt = nil
        finishOnRelease = false
        touch = nil
        phase = .idle
        endBackground()
    }

    private func fail(_ problem: DictationProblem, owner: String) {
        self.owner = owner
        phase = .failed(problem)
        play(.failed, for: owner)
        if problem.fix != .retry, let file {
            try? FileManager.default.removeItem(at: file)
            self.file = nil
        }
        endBackground()
    }

    private func play(_ moment: HapticMoment, for owner: String) {
        feedbackOwner = owner
        feedback = ChatFeedback(moment)
    }

    private func show(_ notice: DictationNotice.Kind?, for owner: String) {
        guard let notice else { return }
        let shown = DictationNotice(owner: owner, kind: notice)
        self.notice = shown
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            if self?.notice == shown { self?.notice = nil }
        }
    }

    // MARK: Transcribing

    private func transcribe() {
        guard let file, let target else { return }
        let settings = VoiceSettings.current()
        let key = keys.key()
        phase = .transcribing(onDevice: key == nil)
        holdBackground()
        work = Task { [weak self] in
            guard let self else { return }
            let terms = await self.terms(settings)
            let outcome = await self.text(of: file, key: key, settings: settings, terms: terms)
            guard !Task.isCancelled, self.target?.id == target.id else { return }
            switch outcome {
            case .success(let text): self.deliver(text.text, onDevice: text.onDevice, to: target, settings: settings, hadKey: key != nil)
            case .failure(let problem): self.fail(problem, owner: target.id)
            }
        }
    }

    /// The session's names when the person wants them and the Mac answers in time, and their own
    /// words always.
    private func terms(_ settings: VoiceSettings) async -> [String] {
        var gathered = DictationSources.empty
        if settings.projectWords, let sources {
            gathered = await Self.within(.milliseconds(1500), sources) ?? .empty
        }
        gathered.dictionary = settings.dictionary
        let ready = gathered
        return await Task.detached(priority: .userInitiated) { dictationTerms(sources: ready) }.value
    }

    private struct Text {
        let text: String
        let onDevice: Bool
    }

    private func text(of file: URL, key: String?, settings: VoiceSettings, terms: [String]) async -> Result<Text, DictationProblem> {
        if let key {
            do {
                let audio = try Data(contentsOf: file)
                let done = try await GrokTranscriber.shared.transcribe(audio: audio, key: key, language: settings.language, terms: terms)
                return .success(Text(text: done.text, onDevice: false))
            } catch let error as DictationError {
                return .failure(DictationProblem(error))
            } catch let error as URLError where DictationProblem.isOffline(error) {
                Logger.core.info("xAI is out of reach; transcribing on this iPhone")
                if case .success(let text) = await onDevice(file, settings: settings, terms: terms) { return .success(text) }
                return .failure(DictationProblem(transport: error))
            } catch let error as URLError {
                return .failure(DictationProblem(transport: error))
            } catch {
                return .failure(DictationProblem(message: "The recording couldn't be sent.", detail: error.localizedDescription, fix: .retry))
            }
        }
        return await onDevice(file, settings: settings, terms: terms)
    }

    private func onDevice(_ file: URL, settings: VoiceSettings, terms: [String]) async -> Result<Text, DictationProblem> {
        do throws(DictationProblem) {
            let text = try await OnDeviceTranscriber.transcribe(file, language: settings.language, terms: terms)
            return .success(Text(text: text, onDevice: true))
        } catch {
            return .failure(error)
        }
    }

    private func deliver(_ text: String, onDevice: Bool, to target: DictationTarget, settings: VoiceSettings, hadKey: Bool) {
        discard()
        guard !text.isEmpty else {
            show(.heardNothing, for: target.id)
            return
        }
        target.insert(text)
        play(.confirmed, for: target.id)
        if onDevice { show(hadKey ? .offline : .noKey, for: target.id) }
        if settings.sendAfterDictating { target.send?() }
    }

    // MARK: Helpers

    /// `addition` after `text`, a space between them unless `text` already ends in white space.
    static func joined(_ text: String, _ addition: String) -> String {
        guard let last = text.last else { return addition }
        return last.isWhitespace ? text + addition : text + " " + addition
    }

    /// The task's value, or `nil` once `limit` has passed.
    private static func within(_ limit: Duration, _ task: Task<DictationSources, Never>) async -> DictationSources? {
        await withTaskGroup(of: DictationSources?.self) { group in
            group.addTask { await task.value }
            group.addTask {
                try? await Task.sleep(for: limit)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private func holdBackground() {
        guard background == .invalid else { return }
        background = UIApplication.shared.beginBackgroundTask(withName: "Broski dictation") { [weak self] in
            self?.endBackground()
        }
    }

    private func endBackground() {
        guard background != .invalid else { return }
        UIApplication.shared.endBackgroundTask(background)
        background = .invalid
    }
}

/// A line under the composer after a dictation, gone after a few seconds.
struct DictationNotice: Equatable {
    enum Kind: Equatable {
        case heardNothing
        case tooShort
        case noKey
        case offline
        case microphoneReady
    }

    let id = UUID()
    let owner: String
    let kind: Kind

    var text: String {
        switch kind {
        case .heardNothing: "Didn't catch any words."
        case .tooShort: "Hold the mic while you talk, or tap it once and tap ✓ when you're done."
        case .noKey: "Transcribed on this iPhone. Add an xAI key in Settings › Voice for sharper code words."
        case .offline: "Transcribed on this iPhone while xAI was out of reach."
        case .microphoneReady: "Microphone on. Tap the mic to dictate."
        }
    }
}
