import BroskiCore
import Foundation

/// Sends a recording to xAI exactly as the core built the request, and reads the answer with the
/// core. Its own session: no cookies, no cache, nothing kept on disk.
struct GrokTranscriber {
    let session: URLSession

    static let shared = GrokTranscriber(session: URLSession(configuration: configuration))

    private static var configuration: URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        configuration.waitsForConnectivity = false
        return configuration
    }

    /// - Throws: `URLError` when no answer came, `DictationError` when xAI said no.
    func transcribe(audio: Data, key: String, language: String?, terms: [String]) async throws -> Transcription {
        let request = dictationRequest(
            apiKey: key, audio: audio, fileName: "dictation.m4a", mimeType: "audio/mp4", language: language, terms: terms)
        return try await send(request)
    }

    /// Whether `key` can transcribe, by sending a quarter second of silence.
    func check(key: String) async throws {
        _ = try await send(dictationKeyCheck(apiKey: key))
    }

    func send(_ request: HttpRequest) async throws -> Transcription {
        guard let url = URL(string: request.url) else { throw URLError(.badURL) }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        for header in request.headers {
            urlRequest.setValue(header.value, forHTTPHeaderField: header.name)
        }
        let (body, response) = try await session.upload(for: urlRequest, from: request.body)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return try dictationResult(status: UInt16(clamping: http.statusCode), body: body)
    }
}
