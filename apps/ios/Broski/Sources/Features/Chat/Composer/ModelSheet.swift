import BroskiCore
import SwiftUI

/// The model sheet, from the composer's pill. On top, the models to pick from: every one when the
/// agent lists a few, else the session's and the pinned ones. Under them Thinking and each mode,
/// each opening its list; then All Models, searchable, where models are pinned. A model is picked
/// with the level last chosen on it.
struct ModelSheet: View {
    let backend: String
    let catalog: ComposerCatalog
    let choices: ComposerChoices
    let cache: CacheWindow?
    let choose: (ComposerChoice) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var path: [Page] = []

    enum Page: Hashable {
        case thinking
        case mode(String)
        case allModels
    }

    /// Up to this many, the agent's models are all listed on top and there is no All Models.
    static let listsAllUpTo = 6

    private var preferences: ModelPreferences { app.modelPreferences }
    private var current: ModelSummary? { catalog.model(choices.modelId) }
    private var listsAll: Bool { catalog.models.count <= Self.listsAllUpTo }

    private var pinned: [ModelSummary] {
        preferences.pinned(backend: backend).compactMap { id in catalog.models.first { $0.id == id } }
    }

    private var shown: [ModelSummary] {
        if listsAll { return catalog.models }
        guard let current, !pinned.contains(where: { $0.id == current.id }) else { return pinned }
        return [current] + pinned
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !shown.isEmpty { models }
                settings
                if !listsAll {
                    Section {
                        NavigationLink(value: Page.allModels) {
                            LabeledContent("All Models", value: "\(catalog.models.count)")
                        }
                    }
                }
            }
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
            }
            .navigationDestination(for: Page.self, destination: page)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var models: some View {
        Section {
            ForEach(shown, id: \.id) { model in
                Button { pick(model) } label: {
                    PickRow(title: model.displayName, detail: detail(model), isChosen: model.id == current?.id)
                }
                .buttonStyle(.plain)
                .swipeActions {
                    if preferences.isPinned(model.id, backend: backend) {
                        Button("Unpin") { preferences.setPinned(false, model.id, backend: backend) }
                    }
                }
            }
        } header: {
            if let cache, cache.warnsOnModelSwitch { CacheSwitchNotice(cache: cache) }
        } footer: {
            if !listsAll && pinned.isEmpty {
                Text("Pin the models you use in All Models to keep them here.")
            }
        }
    }

    @ViewBuilder
    private var settings: some View {
        let thinking = current?.thinking
        if (thinking?.options.isEmpty == false) || !catalog.modes.isEmpty {
            Section {
                if let thinking, !thinking.options.isEmpty {
                    NavigationLink(value: Page.thinking) {
                        LabeledContent("Thinking", value: thinking.title(of: choices.thinking) ?? "Default")
                    }
                }
                ForEach(catalog.modes, id: \.id) { axis in
                    NavigationLink(value: Page.mode(axis.id)) {
                        LabeledContent(axis.label, value: axis.title(of: choices.modes[axis.id]))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func page(_ page: Page) -> some View {
        switch page {
        case .thinking:
            if let current {
                OptionList(
                    title: "Thinking", options: current.thinking.options.map { ($0.value, $0.title, $0.description) },
                    chosen: choices.thinking ?? current.thinking.defaultValue
                ) { value in
                    preferences.remember(level: value, of: current.id, backend: backend)
                    choose(.thinking(value))
                    path.removeLast()
                }
            }
        case .mode(let id):
            if let axis = catalog.modes.first(where: { $0.id == id }) {
                OptionList(
                    title: axis.label, footer: axis.description, options: axis.options.map { ($0.value, $0.label, $0.description) },
                    chosen: choices.modes[axis.id] ?? axis.usualValue
                ) { value in
                    choose(.mode(axis: axis.id, value: value))
                    path.removeLast()
                }
            }
        case .allModels:
            ModelBrowser(backend: backend, models: catalog.models, chosen: current?.id, pick: pick)
        }
    }

    /// The agent's own line about the model when it has one, else where it comes from and the
    /// level it runs at.
    private func detail(_ model: ModelSummary) -> String? {
        if let description = model.description, !description.isEmpty { return description }
        let level = model.id == current?.id ? choices.thinking : preferences.level(of: model.id, backend: backend)
        return [model.provider, model.thinking.title(of: level)].compactMap(\.self).joined(separator: " · ").nilIfEmpty
    }

    private func pick(_ model: ModelSummary) {
        if let current, let level = choices.thinking {
            preferences.remember(level: level, of: current.id, backend: backend)
        }
        let remembered = preferences.level(of: model.id, backend: backend)
        let level = remembered.flatMap { level in model.thinking.options.contains { $0.value == level } ? level : nil }
        if model.id != current?.id || (level != nil && level != choices.thinking) {
            choose(.model(model.id, thinking: level))
        }
        dismiss()
    }
}

/// A level's or a mode's options, the chosen one checked; picking one goes back.
private struct OptionList: View {
    let title: String
    var footer: String?
    let options: [(value: String, title: String, description: String?)]
    let chosen: String?
    let pick: (String) -> Void

    var body: some View {
        List {
            Section {
                ForEach(options, id: \.value) { option in
                    Button { pick(option.value) } label: {
                        PickRow(title: option.title, detail: option.description, isChosen: option.value == chosen)
                    }
                    .buttonStyle(.plain)
                }
            } footer: {
                if let footer { Text(footer) }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One choice: its name, a line under it, and a check when it is the one chosen.
struct PickRow: View {
    let title: String
    let detail: String?
    let isChosen: Bool

    var body: some View {
        HStack(spacing: Spacing.m) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(title).foregroundStyle(.primary)
                if let detail {
                    Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if isChosen {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.accent)
            }
        }
        .padding(.vertical, Spacing.xxs)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isChosen ? .isSelected : [])
    }
}

extension ModelSummary {
    /// Who serves the model, as the agent names them.
    var provider: String? { providerName ?? providerId }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
