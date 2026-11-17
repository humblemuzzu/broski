import AVFoundation
import Foundation
import Speech

/// This iPhone's own recognizer, for when there is no xAI key or no connection: free and private,
/// weaker with code. Apple's dictation model takes the session's names as context; with them it got
/// 34 of 64 developer terms right on Broski's test clips, against 21 for its transcription model.
enum OnDeviceTranscriber {
    /// - Parameter language: an xAI language code, `nil` for this phone's language.
    static func transcribe(_ file: URL, language: String?, terms: [String]) async throws(DictationProblem) -> String {
        let wanted = language.map { Locale(identifier: $0) } ?? Locale.current
        guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: wanted) else {
            throw DictationProblem(
                message: "This iPhone can't transcribe \(wanted.localizedString(forIdentifier: wanted.identifier) ?? "this language") by itself. Add an xAI key in Settings › Voice.",
                fix: .voiceSettings)
        }
        do {
            return try await run(file, locale: locale, terms: terms)
        } catch {
            throw DictationProblem(
                message: "This iPhone couldn't transcribe the recording.", detail: error.localizedDescription, fix: .retry)
        }
    }

    private static func run(_ file: URL, locale: Locale, terms: [String]) async throws -> String {
        let transcriber = DictationTranscriber(locale: locale, preset: .longDictation)
        if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await install.downloadAndInstall()
        }
        let audio = try AVAudioFile(forReading: file)
        guard
            let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: audio.processingFormat)
        else {
            throw Unavailable()
        }
        let buffers = try converted(audio, to: format)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        if !terms.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings[.general] = terms
            try await analyzer.setContext(context)
        }
        let results = Task {
            var text = ""
            for try await result in transcriber.results where result.isFinal {
                text += String(result.text.characters)
            }
            return text
        }
        let input = AsyncStream<AnalyzerInput> { stream in
            for buffer in buffers { stream.yield(AnalyzerInput(buffer: buffer)) }
            stream.finish()
        }
        if let end = try await analyzer.analyzeSequence(input) {
            try await analyzer.finalizeAndFinish(through: end)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        return try await results.value.trimmed
    }

    /// The recognizer has no audio format it takes, as on a simulator without Apple's speech models.
    private struct Unavailable: LocalizedError {
        var errorDescription: String? { "On-device speech recognition isn't available here." }
    }

    private static let chunk: AVAudioFrameCount = 16_384

    /// The file as it is stored, chunk by chunk.
    private static func read(_ audio: AVAudioFile) throws -> [AVAudioPCMBuffer] {
        var buffers: [AVAudioPCMBuffer] = []
        while audio.framePosition < audio.length {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: chunk) else { break }
            try audio.read(into: buffer, frameCount: chunk)
            if buffer.frameLength == 0 { break }
            buffers.append(buffer)
        }
        return buffers
    }

    /// The file in the format the recognizer takes: the recorder's AAC decodes to a format the
    /// analyzer may refuse ("Audio format is not supported"), so every chunk goes through a converter.
    private static func converted(_ audio: AVAudioFile, to format: AVAudioFormat) throws -> [AVAudioPCMBuffer] {
        let source = try read(audio)
        guard audio.processingFormat != format, let converter = AVAudioConverter(from: audio.processingFormat, to: format) else {
            return source
        }
        let ratio = format.sampleRate / audio.processingFormat.sampleRate
        var output: [AVAudioPCMBuffer] = []
        for (index, buffer) in source.enumerated() {
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1_024
            guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { continue }
            var given = false
            var failure: NSError?
            let status = converter.convert(to: out, error: &failure) { _, state in
                if given {
                    state.pointee = index == source.count - 1 ? .endOfStream : .noDataNow
                    return nil
                }
                given = true
                state.pointee = .haveData
                return buffer
            }
            if let failure, status == .error { throw failure }
            if out.frameLength > 0 { output.append(out) }
        }
        return output
    }
}
