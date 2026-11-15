#if DEBUG
import BroskiCore
import Foundation
import os

/// Nothing in the app starts a run until the chat's composer lands, so the end-to-end run
/// (`scripts/e2e-ios-app.sh`) starts one through the app's own core: a Debug build launched with
/// `BROSKI_E2E_PROMPT` (`{"machine":…,"backend":…,"sessionId":…}`) views that session, sends it one
/// prompt (the bridge takes a prompt only for a session the phone views), and lets the view go.
/// The composer replaces this, and this file goes with it.
enum E2EPrompt {
    private struct Target: Decodable {
        let machine: String
        let backend: String
        let sessionId: String
    }

    static func sendIfAsked(_ model: AppModel) {
        guard let json = ProcessInfo.processInfo.environment["BROSKI_E2E_PROMPT"],
            let target = try? JSONDecoder().decode(Target.self, from: Data(json.utf8)),
            let backend = BackendId(wireName: target.backend),
            let machine = model.machine(id: target.machine)
        else { return }
        let input = PromptInput(
            clientRequestId: UUID().uuidString, mode: .start, text: "Run until released", attachments: [], command: nil)
        let session = SessionRef(backend: backend, sessionId: target.sessionId)
        Task {
            do {
                let view = try machine.machine.attach(session: session)
                defer { view.detach() }
                let answer = try await machine.machine.request(
                    message: .prompt(PromptRequest(requestId: "", session: session, input: input)))
                Logger.core.info("the end-to-end prompt was answered: \(String(describing: answer), privacy: .public)")
            } catch {
                Logger.core.error("the end-to-end prompt failed: \(String(describing: error), privacy: .public)")
            }
        }
    }
}
#endif
