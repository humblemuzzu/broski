import BroskiCore
import SwiftUI

/// The agents this Mac has, inline: each with its mark, the chosen one tinted; one that cannot run
/// now is disabled and says why and what fixes it, in the agent's own words.
struct AgentPicker: View {
    let machine: MachineModel
    @Binding var selection: BackendId?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(spacing: Spacing.s) {
                ForEach(machine.backends, id: \.id) { backend in
                    chip(backend.id)
                }
            }
            ForEach(machine.backends.compactMap { reason(for: $0.id) }, id: \.self) { reason in
                Text(reason).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .haptic(.pickerStep, trigger: selection)
    }

    private func chip(_ backend: BackendId) -> some View {
        let chosen = backend == selection
        let usable = machine.backendStatuses[backend]?.usable ?? true
        return Button { selection = backend } label: {
            HStack(spacing: Spacing.s) {
                AgentMark(backend: backend).scaleEffect(0.7).frame(width: 26, height: 26)
                Text(backend.displayName).font(.subheadline.weight(.semibold))
            }
            .padding(.leading, Spacing.xs)
            .padding(.trailing, Spacing.m)
            .padding(.vertical, Spacing.xs)
            .background(chosen ? Palette.accent.opacity(0.16) : Color(uiColor: .tertiarySystemFill), in: .capsule)
            .overlay { Capsule().strokeBorder(chosen ? Palette.accent : .clear, lineWidth: 1.5) }
            .opacity(usable ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!usable)
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityValue(usable ? "" : "Unavailable")
    }

    /// Why the chosen agent cannot run: not installed, signed out, or its own issues.
    private func reason(for backend: BackendId) -> String? {
        guard let status = machine.backendStatuses[backend], !status.usable else { return nil }
        if !status.installed { return "\(backend.displayName) isn't installed on \(machine.name). Install it there, then try again." }
        if status.auth == .signedOut { return "\(backend.displayName) isn't signed in on \(machine.name). Sign in there, then try again." }
        return status.issues.map(\.message).joined(separator: " ")
    }
}
