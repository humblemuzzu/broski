import BroskiCore
import SwiftUI

/// A form a tool asks for (an MCP server's elicitation): each shown field as its native control,
/// fields appearing as the answers they depend on are given, Submit once the required ones are in.
struct FormCard: View {
    let request: FormRequest
    let isSending: Bool
    let send: (InteractionReply) -> Void
    @State private var draft: FormDraft

    init(request: FormRequest, isSending: Bool, send: @escaping (InteractionReply) -> Void) {
        self.request = request
        self.isSending = isSending
        self.send = send
        _draft = State(initialValue: FormDraft(request))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if let server = request.server {
                Text("From \(server)").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(draft.shown(request), id: \.key) { field in
                FormFieldView(field: field, value: $draft[field.key])
            }
            Button {
                send(draft.reply(request))
            } label: {
                Text("Submit").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(isSending || !draft.missing(request).isEmpty)
        }
        .animation(.easeOut(duration: 0.2), value: draft.shown(request).map(\.key))
    }
}

private struct FormFieldView: View {
    let field: FormFieldSpec
    @Binding var value: FormValue?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if case .boolean = field {} else {
                Text(field.label + (field.required ? "" : " (optional)")).font(.subheadline.weight(.medium))
            }
            control
            if let detail = field.detail {
                FormattedMessage(text: detail, role: .quiet)
            }
        }
    }

    @ViewBuilder
    private var control: some View {
        switch field {
        case .string(let spec):
            if !spec.options.isEmpty && !spec.allowCustom {
                Picker(field.label, selection: text) {
                    Text("Choose…").tag("")
                    ForEach(spec.options, id: \.value) { Text($0.label).tag($0.value) }
                }
                .pickerStyle(.menu)
            } else {
                TextField(spec.placeholder ?? "", text: text)
                    .keyboardType(spec.format == .email ? .emailAddress : spec.format == .uri ? .URL : .default)
                    .textInputAutocapitalization(spec.format == nil ? .sentences : .never)
                    .fieldBackground()
            }
        case .number:
            TextField("", value: number, format: .number).keyboardType(.decimalPad).fieldBackground()
        case .integer:
            TextField("", value: number, format: .number.precision(.fractionLength(0))).keyboardType(.numberPad)
                .fieldBackground()
        case .boolean:
            Toggle(field.label, isOn: Binding {
                if case .boolean(let on) = value { on.value } else { false }
            } set: { value = .boolean(BooleanValue(value: $0)) })
            .font(.subheadline.weight(.medium))
        case .multiselect(let spec):
            ForEach(spec.options, id: \.value) { option in
                Toggle(option.label, isOn: choice(option.value)).font(.subheadline)
            }
        }
    }

    private var text: Binding<String> {
        Binding {
            if case .text(let text) = value { text.value } else { "" }
        } set: {
            value = $0.isEmpty ? nil : .text(TextValue(value: $0))
        }
    }

    private var number: Binding<Double?> {
        Binding {
            if case .number(let number) = value { number.value } else { nil }
        } set: {
            value = $0.map { .number(NumberValue(value: $0)) }
        }
    }

    private func choice(_ option: String) -> Binding<Bool> {
        Binding {
            if case .choices(let chosen) = value { chosen.values.contains(option) } else { false }
        } set: { on in
            var chosen = if case .choices(let chosen) = value { chosen.values } else { [String]() }
            chosen.removeAll { $0 == option }
            if on { chosen.append(option) }
            value = chosen.isEmpty ? nil : .choices(ChoicesValue(values: chosen))
        }
    }
}

extension View {
    /// A text field's quiet fill inside a card.
    func fieldBackground() -> some View {
        font(.subheadline)
            .padding(.horizontal, Spacing.m)
            .padding(.vertical, Spacing.s)
            .background(Color(uiColor: .tertiarySystemFill), in: .rect(cornerRadius: 14, style: .continuous))
    }
}
