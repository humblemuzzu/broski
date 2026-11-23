import BroskiCore
import SwiftUI

/// What sits in the expanded composer's row between `+` and the mic: the model and its thinking
/// level as one pill, "Opus 5.5 High", which opens the model sheet; then each mode the session runs
/// off its default (Plan, Accept edits, Ask first…), so a session that is not as it usually is says
/// so where the person types. A mode at its default shows nothing; the sheet changes it.
struct ComposerPickers: View {
    let catalog: ComposerCatalog
    let choices: ComposerChoices
    let choose: (ComposerChoice) -> Void
    let openModel: () -> Void

    private var model: ModelSummary? { catalog.model(choices.modelId) }

    private var modelName: String? {
        model?.pillName ?? choices.modelId.map { $0.split(separator: "/").last.map(String.init) ?? $0 }
    }

    private var level: String? {
        guard let model else { return nil }
        return model.thinking.title(of: choices.thinking)
    }

    var body: some View {
        HStack(spacing: Spacing.s) {
            if let modelName {
                Button(action: openModel) {
                    HStack(spacing: 5) {
                        Text(modelName).foregroundStyle(.primary)
                        if let level {
                            Text(level).foregroundStyle(.secondary).layoutPriority(1)
                        }
                    }
                    .pickerCapsule()
                }
                .buttonStyle(.plain)
                .accessibilityLabel(["Model", modelName, level].compactMap(\.self).joined(separator: ", "))
            }
            ForEach(catalog.modes, id: \.id) { axis in
                if let option = axis.changedOption(choices.modes[axis.id]) {
                    modeChip(axis, option)
                }
            }
        }
        .lineLimit(1)
        .animation(.snappy(duration: 0.22), value: choices)
    }

    private func modeChip(_ axis: ModeAxis, _ option: ContractOption) -> some View {
        Menu {
            Picker(axis.label, selection: Binding { option.value } set: { choose(.mode(axis: axis.id, value: $0)) }) {
                ForEach(axis.options, id: \.value) { option in
                    VStack {
                        Text(option.label)
                        if let description = option.description { Text(description) }
                    }
                    .tag(option.value)
                }
            }
        } label: {
            Text(option.label).foregroundStyle(.primary).pickerCapsule()
        }
        .buttonStyle(.plain)
        .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .leading)))
        .accessibilityLabel("\(axis.label), \(option.label)")
    }
}

private extension View {
    func pickerCapsule() -> some View {
        font(.callout)
            .padding(.horizontal, 14)
            .frame(height: ComposerMetrics.control)
            .background(Color.composerFill, in: .capsule)
            .contentShape(.capsule)
    }
}

extension ModelSummary {
    /// The name without what the agent adds in brackets ("Default (recommended)" is "Default"),
    /// short enough for the composer's pill; lists show `displayName` whole.
    var pillName: String {
        guard displayName.hasSuffix(")"), let open = displayName.lastIndex(of: "("), open > displayName.startIndex else {
            return displayName
        }
        let name = displayName[..<open].trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? displayName : name
    }
}

extension ThinkingOption {
    var title: String { label ?? value.capitalized }
}

extension ThinkingSpec {
    /// The level's title, the model's default standing in for none; `nil` when neither is one of
    /// its levels.
    func title(of value: String?) -> String? {
        guard let value = value ?? defaultValue else { return nil }
        return options.first { $0.value == value }?.title
    }
}

extension ModeAxis {
    /// What a session runs under unless told otherwise: the axis's default, else its first option.
    var usualValue: String? { defaultValue ?? options.first?.value }

    /// The option `value` names when it is not the usual one.
    func changedOption(_ value: String?) -> ContractOption? {
        guard let value, value != usualValue else { return nil }
        return options.first { $0.value == value }
    }

    func title(of value: String?) -> String {
        let value = value ?? usualValue
        return options.first { $0.value == value }?.label ?? value ?? label
    }
}
