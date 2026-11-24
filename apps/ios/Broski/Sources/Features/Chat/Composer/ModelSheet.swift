import BroskiCore
import SwiftUI

/// The model sheet, from the composer's pill. On top, the models on a wheel: every one when the
/// agent lists a few, else the one the sheet opened on and the pinned ones. The model in the band is
/// chosen once the wheel rests, with the level last chosen on it, and a tap on it opens its thinking
/// level's slider. Under the wheel each mode, opening its list; then All Models, searchable, where
/// models are pinned.
struct ModelSheet: View {
    let backend: String
    let catalog: ComposerCatalog
    let choices: ComposerChoices
    let cache: CacheWindow?
    let choose: (ComposerChoice) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var path: [Page] = []
    @State private var centered: String?
    /// Kept on the wheel while the sheet is open, so choosing a pinned model drops no row from it.
    @State private var openedOn: String?

    init(
        backend: String, catalog: ComposerCatalog, choices: ComposerChoices, cache: CacheWindow?,
        choose: @escaping (ComposerChoice) -> Void
    ) {
        self.backend = backend
        self.catalog = catalog
        self.choices = choices
        self.cache = cache
        self.choose = choose
        let current = catalog.model(choices.modelId)?.id
        _centered = State(initialValue: current)
        _openedOn = State(initialValue: current)
    }

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
        ModelSheet.wheel(catalog.models, pinned: preferences.pinned(backend: backend), openedOn: openedOn, listsAll: listsAll)
    }

    /// The wheel's models: every one when the agent lists a few, else the pinned ones in the order
    /// pinned, after the model the sheet opened on when that one is not pinned.
    static func wheel(_ models: [ModelSummary], pinned: [String], openedOn: String?, listsAll: Bool) -> [ModelSummary] {
        if listsAll { return models }
        let ids = openedOn.map { pinned.contains($0) ? pinned : [$0] + pinned } ?? pinned
        return ids.compactMap { id in models.first { $0.id == id } }
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
            ModelWheel(
                models: shown, centered: $centered,
                level: { model in model.id == current?.id ? choices.thinking : preferences.level(of: model.id, backend: backend) },
                settle: { select($0) },
                tapCentered: { model in
                    if model.thinking.options.isEmpty { dismiss() } else { path.append(.thinking) }
                },
                isPinned: { preferences.isPinned($0.id, backend: backend) },
                unpin: { preferences.setPinned(false, $0.id, backend: backend) }
            )
            .listRowInsets(EdgeInsets(top: Spacing.xs, leading: 0, bottom: Spacing.s, trailing: 0))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
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
        if !catalog.modes.isEmpty {
            Section {
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
                ThinkingPage(model: current, chosen: choices.thinking) { value in
                    preferences.remember(level: value, of: current.id, backend: backend)
                    choose(.thinking(value))
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

    /// Chooses `model` with the level last chosen on it, keeping the level of the one it replaces.
    private func select(_ model: ModelSummary) {
        if let current, let level = choices.thinking {
            preferences.remember(level: level, of: current.id, backend: backend)
        }
        let remembered = preferences.level(of: model.id, backend: backend)
        let level = remembered.flatMap { level in model.thinking.options.contains { $0.value == level } ? level : nil }
        if model.id != current?.id || (level != nil && level != choices.thinking) {
            choose(.model(model.id, thinking: level))
        }
    }

    private func pick(_ model: ModelSummary) {
        select(model)
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
