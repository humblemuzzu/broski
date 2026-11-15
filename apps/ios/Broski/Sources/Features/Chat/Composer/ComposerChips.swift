import BroskiCore
import SwiftUI

/// The chips under the field: the model (a menu, or a searchable sheet past a dozen, nothing when
/// there is one), the model's thinking levels, and one chip per mode axis. Plain text on the
/// composer's glass, never glass on glass; every step plays the picker haptic.
struct ComposerChips: View {
    let catalog: ComposerCatalog
    let choices: ComposerChoices
    let choose: (ComposerChoice) -> Void
    @State private var pickingModel = false
    @State private var steps = 0

    static let menuLimit = 12

    private var model: ModelSummary? { catalog.model(choices.modelId) }

    var body: some View {
        HStack(spacing: Spacing.m) {
            modelChip
            if let model, !model.thinking.options.isEmpty {
                thinkingChip(model.thinking)
            }
            ForEach(catalog.modes, id: \.id) { axis in
                modeChip(axis)
            }
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(.secondary)
        .haptic(.pickerStep, trigger: steps)
        .sheet(isPresented: $pickingModel) {
            ModelPickerSheet(models: catalog.models, selected: model?.id) {
                steps += 1
                choose(.model($0))
            }
        }
    }

    @ViewBuilder
    private var modelChip: some View {
        if catalog.models.count > Self.menuLimit {
            Button { pickingModel = true } label: { ChipLabel(text: model?.displayName ?? "Model") }
                .buttonStyle(.plain)
                .accessibilityLabel("Model, \(model?.displayName ?? "default")")
        } else if catalog.models.count > 1 {
            Menu {
                Picker("Model", selection: binding(model?.id ?? "") { choose(.model($0)) }) {
                    ForEach(catalog.models, id: \.id) { model in
                        Text(model.displayName).tag(model.id)
                    }
                }
            } label: {
                ChipLabel(text: model?.displayName ?? "Model")
            }
            .accessibilityLabel("Model, \(model?.displayName ?? "default")")
        }
    }

    private func thinkingChip(_ spec: ThinkingSpec) -> some View {
        let current = choices.thinking ?? spec.defaultValue
        let label = spec.options.first { $0.value == current }.map(\.title) ?? "Thinking"
        return Menu {
            Picker("Thinking", selection: binding(current ?? "") { choose(.thinking($0)) }) {
                ForEach(spec.options, id: \.value) { option in
                    Text(option.title).tag(option.value)
                }
            }
        } label: {
            ChipLabel(text: label, symbol: "brain")
        }
        .accessibilityLabel("Thinking, \(label)")
    }

    private func modeChip(_ axis: ModeAxis) -> some View {
        let current = choices.modes[axis.id] ?? axis.defaultValue
        let label = axis.options.first { $0.value == current }?.label ?? axis.label
        return Menu {
            Picker(axis.label, selection: binding(current ?? "") { choose(.mode(axis: axis.id, value: $0)) }) {
                ForEach(axis.options, id: \.value) { option in
                    VStack {
                        Text(option.label)
                        if let description = option.description { Text(description) }
                    }
                    .tag(option.value)
                }
            }
        } label: {
            ChipLabel(text: label)
        }
        .accessibilityLabel("\(axis.label), \(label)")
    }

    private func binding(_ value: String, set: @escaping (String) -> Void) -> Binding<String> {
        Binding { value } set: {
            guard $0 != value else { return }
            steps += 1
            set($0)
        }
    }
}

private struct ChipLabel: View {
    let text: String
    var symbol: String?

    var body: some View {
        HStack(spacing: Spacing.xxs + 1) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(text).lineLimit(1)
            Image(systemName: "chevron.up.chevron.down").imageScale(.small).font(.caption2)
        }
        .frame(minHeight: 32)
        .contentShape(.rect)
    }
}

extension ThinkingOption {
    var title: String { label ?? value.capitalized }
}

/// Models past a dozen: one sheet, searchable, each with its provider beneath and a check on the
/// chosen one.
private struct ModelPickerSheet: View {
    let models: [ModelSummary]
    let selected: String?
    let choose: (String) -> Void
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    private var shown: [ModelSummary] {
        let query = query.trimmed.lowercased()
        guard !query.isEmpty else { return models }
        return models.filter {
            $0.displayName.lowercased().contains(query) || ($0.providerName ?? "").lowercased().contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            List(shown, id: \.id) { model in
                Button {
                    choose(model.id)
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(model.displayName).foregroundStyle(.primary)
                            if let provider = model.providerName ?? model.providerId {
                                Text(provider).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if model.id == selected {
                            Image(systemName: "checkmark").foregroundStyle(Palette.accent)
                        }
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
