import BroskiCore
import Foundation
import Testing

@testable import Broski

/// Dictation's iOS side: the upload goes out exactly as the core built it, xAI's answers become
/// what the person sees, and text lands in the draft as typed.
struct VoiceTests {
    private static let audio = Data("\u{0}\u{0}\u{0}\u{1C}ftypM4A recorded speech".utf8)

    @Test(.timeLimit(.minutes(1)))
    func anUploadGoesOutAsTheCoreBuiltItAndItsTranscriptComesBack() async throws {
        let answer = #"{"text":"Rename isLoading in SessionView.swift","language":"en","duration":2.5,"words":[]}"#
        let server = try LocalHTTPServer(status: 200, body: Data(answer.utf8))
        let port = try await server.start()
        defer { server.stop() }
        var request = dictationRequest(
            apiKey: "xai-test", audio: Self.audio, fileName: "dictation.m4a", mimeType: "audio/mp4", language: "en",
            terms: ["isLoading", "SessionView.swift"])
        request.url = "http://127.0.0.1:\(port)/v1/stt"

        let transcription = try await GrokTranscriber.shared.send(request)

        #expect(transcription.text == "Rename isLoading in SessionView.swift")
        #expect(transcription.durationSeconds == 2.5)
        let received = try #require(server.requests.first)
        #expect(received.method == "POST")
        #expect(received.path == "/v1/stt")
        #expect(received.body == request.body)
        #expect(received.headers["authorization"] == "Bearer xai-test")
        #expect(received.headers["content-type"]?.hasPrefix("multipart/form-data; boundary=") == true)
        let form = String(decoding: received.body, as: UTF8.self)
        #expect(form.contains("grok-voice-transcribe-2.0"))
        #expect(form.contains("name=\"keyterm\"\r\n\r\nisLoading"))
    }

    @Test(.timeLimit(.minutes(1)))
    func aRefusedKeyAsksForVoiceSettings() async throws {
        let refusal = #"{"code":"Client specified an invalid argument","error":"Incorrect API key provided."}"#
        let server = try LocalHTTPServer(status: 400, body: Data(refusal.utf8))
        let port = try await server.start()
        defer { server.stop() }
        var request = dictationKeyCheck(apiKey: "xai-wrong")
        request.url = "http://127.0.0.1:\(port)/v1/stt"

        let error = await #expect(throws: DictationError.self) { try await GrokTranscriber.shared.send(request) }

        let problem = DictationProblem(try #require(error))
        #expect(problem.fix == .voiceSettings)
        #expect(problem.detail == "Incorrect API key provided.")
    }

    @Test
    func failuresSayWhetherTheRecordingCanGoAgain() {
        #expect(DictationProblem(.RateLimited(detail: "")).fix == .retry)
        #expect(DictationProblem(.Unavailable(status: 503, detail: "down")).fix == .retry)
        #expect(DictationProblem(.TooLarge).fix == .none)
        #expect(DictationProblem(.Rejected(detail: "Failed to decode audio")).fix == .none)
        #expect(DictationProblem(transport: URLError(.notConnectedToInternet)).fix == .retry)
        #expect(DictationProblem.isOffline(URLError(.notConnectedToInternet)))
        #expect(!DictationProblem.isOffline(URLError(.timedOut)))
    }

    @Test
    func dictatedTextJoinsTheDraftWithOneSpace() {
        #expect(Dictation.joined("", "run bun test") == "run bun test")
        #expect(Dictation.joined("Then", "run bun test") == "Then run bun test")
        #expect(Dictation.joined("Then\n", "run bun test") == "Then\nrun bun test")
        #expect(Dictation.joined("Then ", "run bun test") == "Then run bun test")
    }

    @Test
    func settingsReadTheirDefaultsAndTheStoredWords() throws {
        let suite = "com.muzammil.broski.tests.voice.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let fresh = VoiceSettings.current(defaults)
        #expect(fresh == VoiceSettings(language: "en", sendAfterDictating: false, projectWords: true, dictionary: []))

        defaults.set(VoiceLanguage.detect, forKey: VoicePreference.language)
        defaults.set(false, forKey: VoicePreference.projectWords)
        defaults.set("Broski\n  Ghostty \n\n", forKey: VoicePreference.dictionary)
        let stored = VoiceSettings.current(defaults)
        #expect(stored.language == nil)
        #expect(!stored.projectWords)
        #expect(stored.dictionary == ["Broski", "Ghostty"])
    }

    @Test
    func aKeyShowsOnlyItsPrefixAndLastCharacters() {
        #expect(VoiceKeyStore.masked("xai-abcdefghijklmnop1234") == "xai-…1234")
    }
}
