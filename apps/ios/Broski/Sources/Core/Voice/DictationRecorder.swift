import AVFoundation
import Foundation
import os

/// The microphone, recorded to an AAC `.m4a` at 16 kHz mono and 32 kbit/s: what xAI's model takes
/// natively, about 4 KB a second, so a minute uploads in a blink even on a weak connection.
@MainActor
final class DictationRecorder: NSObject, AVAudioRecorderDelegate {
    /// xAI takes 500 MB; ten minutes is a long prompt already, and 2.4 MB.
    static let longest: TimeInterval = 600

    /// The recording stopped by itself: it reached `longest`, or the system interrupted it.
    var stoppedByItself: (() -> Void)?

    private var recorder: AVAudioRecorder?
    private var interruptions: (any NSObjectProtocol)?

    static var permission: AVAudioApplication.recordPermission { AVAudioApplication.shared.recordPermission }

    static func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    /// Starts recording into a new file in the dictation folder.
    func start() throws -> URL {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers, .allowBluetoothHFP, .defaultToSpeaker])
        try session.setActive(true)
        let url = Self.folder.appending(path: "\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        recorder.isMeteringEnabled = true
        guard recorder.record(forDuration: Self.longest) else {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw RecorderFailure()
        }
        self.recorder = recorder
        interruptions = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: .main
        ) { [weak self] note in
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
            guard type == .began else { return }
            MainActor.assumeIsolated { self?.stoppedByItself?() }
        }
        return url
    }

    /// The loudness now, 0 for silence to 1 for shouting, on a curve that makes speech move.
    func level() -> Float {
        guard let recorder else { return 0 }
        recorder.updateMeters()
        let decibels = recorder.averagePower(forChannel: 0)
        let linear = max(0, min(1, (decibels + 50) / 50))
        return linear * linear
    }

    /// Stops and keeps the file; `nil` when nothing was recording.
    func stop() -> URL? {
        guard let recorder else { return nil }
        recorder.delegate = nil
        recorder.stop()
        end()
        return recorder.url
    }

    /// Stops and deletes the file.
    func cancel() {
        guard let recorder else { return }
        recorder.delegate = nil
        recorder.stop()
        recorder.deleteRecording()
        end()
    }

    private func end() {
        recorder = nil
        if let interruptions { NotificationCenter.default.removeObserver(interruptions) }
        interruptions = nil
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            Logger.core.error("the audio session did not end: \(error.localizedDescription, privacy: .public)")
        }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor [weak self] in self?.stoppedByItself?() }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: (any Error)?) {
        Task { @MainActor [weak self] in self?.stoppedByItself?() }
    }

    /// Where recordings wait until they are transcribed or thrown away; emptied at launch.
    static var folder: URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: "Dictation", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    static func removeLeftovers() {
        try? FileManager.default.removeItem(at: folder)
    }

    struct RecorderFailure: Error {}
}
