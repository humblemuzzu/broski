import BroskiCore
import SwiftUI

/// Every model the agent lists, one section per provider, the chosen model's provider open and the
/// rest folded; a search opens them all and matches names, ids and providers. Each row picks its
/// model, and its pin keeps it on the sheet's first page.
struct ModelBrowser: View {
    let backend: String
    let models: [ModelSummary]
    let chosen: String?
    let pick: (ModelSummary) -> Void
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var open: Set<String> = []

    private var preferences: ModelPreferences { app.modelPreferences }

    private struct Group: Identifiable {
        let provider: String
        let models: [ModelSummary]
        var id: String { provider }
    }

    private var groups: [Group] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        let matching = words.isEmpty ? models : models.filter { model in
            let haystack = [model.displayName, model.id, model.provider ?? ""].joined(separator: " ").lowercased()
            return words.allSatisfy(haystack.contains)
        }
        let chosenProvider = models.first { $0.id == chosen }.flatMap(\.provider)
        return Dictionary(grouping: matching) { $0.provider ?? "Models" }
            .map { Group(provider: $0.key, models: $0.value) }
            .sorted { lhs, rhs in
                if (lhs.provider == chosenProvider) != (rhs.provider == chosenProvider) { return lhs.provider == chosenProvider }
                return lhs.provider.localizedStandardCompare(rhs.provider) == .orderedAscending
            }
    }

    var body: some View {
        List {
            ForEach(groups) { group in
                Section(isExpanded: expanded(group.provider)) {
                    ForEach(group.models, id: \.id, content: row)
                } header: {
                    Text(group.provider)
                }
            }
        }
        .listStyle(.sidebar)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search \(models.count) models")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .overlay {
            if groups.isEmpty { ContentUnavailableView.search(text: query) }
        }
        .navigationTitle("All Models")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if open.isEmpty, let provider = models.first(where: { $0.id == chosen })?.provider { open = [provider] }
        }
    }

    private func expanded(_ provider: String) -> Binding<Bool> {
        Binding {
            !query.isEmpty || open.contains(provider)
        } set: { isOpen in
            if isOpen { open.insert(provider) } else { open.remove(provider) }
        }
    }

    private func row(_ model: ModelSummary) -> some View {
        let isPinned = preferences.isPinned(model.id, backend: backend)
        return HStack(spacing: Spacing.s) {
            Button { pick(model) } label: {
                PickRow(title: model.displayName, detail: detail(model), isChosen: model.id == chosen)
            }
            .buttonStyle(.borderless)
            Button {
                preferences.setPinned(!isPinned, model.id, backend: backend)
            } label: {
                Image(systemName: isPinned ? "pin.fill" : "pin")
                    .font(.subheadline)
                    .foregroundStyle(isPinned ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
                    .frame(width: 36, height: 36)
                    .contentShape(.rect)
            }
            .buttonStyle(.borderless)
            .disabled(!isPinned && !preferences.canPin(backend: backend))
            .sensoryFeedback(.selection, trigger: isPinned)
            .accessibilityLabel(isPinned ? "Unpin \(model.displayName)" : "Pin \(model.displayName)")
        }
    }

    /// The model's own id under its name, without the provider the section already names, and its
    /// context window.
    private func detail(_ model: ModelSummary) -> String? {
        var id = model.id
        if let provider = model.providerId, id.hasPrefix(provider + "/") { id.removeFirst(provider.count + 1) }
        let context = model.contextWindow.map { CacheFormat.tokens($0) }
        let parts = [id == model.displayName ? nil : id, context].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
