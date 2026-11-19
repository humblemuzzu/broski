import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// Dictation: the xAI key, the spoken language, sending after dictating, the session's names, and
/// the person's own words.
struct VoiceSettingsScreen: View {
    /// Shown in a sheet from the composer, with a Done button.
    var closes = false
    @State private var key = VoiceKeyModel()
    @AppStorage(VoicePreference.language) private var language = VoiceLanguage.standard
    @AppStorage(VoicePreference.sendAfterDictating) private var sendAfter = false
    @AppStorage(VoicePreference.projectWords) private var projectWords = true
    @AppStorage(VoicePreference.dictionary) private var dictionary = ""
    @Environment(\.dismiss) private var dismiss
    private let languages = dictationLanguages()

    var body: some View {
        Form {
            VoiceKeySection(key: key)
            Section {
                Picker("Language", selection: $language) {
                    Text("Detect Automatically").tag(VoiceLanguage.detect)
                    ForEach(languages, id: \.code) { language in
                        Text(language.name).tag(language.code)
                    }
                }
                Toggle("Send After Dictating", isOn: $sendAfter)
                Toggle("Use Project Words", isOn: $projectWords)
            } header: {
                Text("Dictation")
            } footer: {
                Text(dictationFooter)
            }
            DictionarySection(stored: $dictionary)
        }
        .navigationTitle("Voice")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if closes {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { key.load() }
    }

    private var dictationFooter: String {
        let formats = languages.first { $0.code == language }?.formats ?? false
        let language = formats
            ? "Numbers, paths and code are written the way you'd type them."
            : "Pick English, or another language xAI formats, to get paths and code written the way you'd type them."
        return "\(language) Project words send up to 100 names from the session, like files, identifiers and commands, so they come out spelled right."
    }
}

/// The key: paste, check with xAI, save to this phone's keychain; or remove.
private struct VoiceKeySection: View {
    let key: VoiceKeyModel
    @State private var entry = ""
    @FocusState private var editing: Bool

    var body: some View {
        Section {
            if let saved = key.saved {
                LabeledContent("xAI Key", value: VoiceKeyStore.masked(saved))
                Button("Remove Key", role: .destructive) { key.remove() }
            } else {
                SecureField("Paste your xAI API key", text: $entry)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($editing)
                    .submitLabel(.done)
                    .onSubmit(save)
                Button(action: save) {
                    if key.isChecking {
                        HStack { Orb(.connecting); Text("Checking with xAI…") }
                    } else {
                        Text("Save Key")
                    }
                }
                .disabled(entry.trimmed.isEmpty || key.isChecking)
                Link("Get a Key at console.x.ai", destination: URL(string: "https://console.x.ai/team/default/api-keys")!)
            }
            if let problem = key.problem {
                Banner(style: .error, message: problem.message, detail: problem.detail)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } else if let note = key.note {
                Text(note).font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("xAI")
        } footer: {
            Text(
                "Your voice goes straight from this iPhone to xAI's Grok Voice Transcribe 2.0, about $0.10 per hour of speech, billed to your xAI account. Your Mac never hears it. Without a key, this iPhone transcribes by itself: free and private, but weaker with code."
            )
        }
    }

    private func save() {
        editing = false
        Task {
            if await key.save(entry) { entry = "" }
        }
    }
}

/// The person's own words, always sent first: names the model should spell their way.
private struct DictionarySection: View {
    @Binding var stored: String
    @State private var entry = ""

    private var words: [String] { VoiceSettings.words(stored) }

    var body: some View {
        Section {
            ForEach(words, id: \.self) { word in
                Text(word)
            }
            .onDelete { offsets in
                var kept = words
                kept.remove(atOffsets: offsets)
                stored = kept.joined(separator: "\n")
            }
            HStack {
                TextField("Add a word or name", text: $entry)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .onSubmit(add)
                Button("Add", action: add)
                    .disabled(!canAdd)
            }
        } header: {
            Text("Your Words")
        } footer: {
            Text("People, products and your own tools, up to 50 characters each. They go with every recording.")
        }
    }

    private var canAdd: Bool {
        let word = entry.trimmed
        return !word.isEmpty && word.count <= 50 && !words.contains { $0.caseInsensitiveCompare(word) == .orderedSame }
    }

    private func add() {
        guard canAdd else { return }
        stored = (words + [entry.trimmed]).joined(separator: "\n")
        entry = ""
    }
}

/// The saved key and checking a new one with xAI before it is kept.
@Observable
final class VoiceKeyModel {
    private(set) var saved: String?
    private(set) var isChecking = false
    private(set) var problem: DictationProblem?
    private(set) var note: String?
    @ObservationIgnored private let store = VoiceKeyStore()

    func load() {
        saved = store.key()
    }

    /// Checks `entry` with xAI and keeps it when xAI takes it, or when xAI cannot be reached to say.
    func save(_ entry: String) async -> Bool {
        let candidate = entry.trimmed
        guard !candidate.isEmpty else { return false }
        isChecking = true
        problem = nil
        note = nil
        defer { isChecking = false }
        do {
            try await GrokTranscriber.shared.check(key: candidate)
        } catch let error as DictationError {
            problem = DictationProblem(error)
            return false
        } catch let error as URLError {
            note = "Saved without checking: xAI couldn't be reached (\(error.code.rawValue))."
        } catch {
            note = "Saved without checking: \(error.localizedDescription)"
        }
        do throws(Keychain.Failure) {
            try store.save(candidate)
        } catch {
            problem = DictationProblem(message: "The key couldn't be saved to this iPhone's keychain.", detail: "OSStatus \(error.status)", fix: .none)
            return false
        }
        saved = candidate
        if note == nil { note = "xAI took the key. Dictation now uses Grok." }
        return true
    }

    func remove() {
        do throws(Keychain.Failure) {
            try store.remove()
            saved = nil
            note = nil
            problem = nil
        } catch {
            problem = DictationProblem(message: "The key couldn't be removed.", detail: "OSStatus \(error.status)", fix: .none)
        }
    }
}
