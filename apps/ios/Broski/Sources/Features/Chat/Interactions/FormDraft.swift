import BroskiCore

/// A form's values as the person fills them in, starting from each field's default. Which fields
/// show is the core's (`formFieldShown`), and only shown fields are sent.
struct FormDraft: Equatable {
    private(set) var values: [String: FormValue] = [:]

    init(_ request: FormRequest) {
        for field in request.fields {
            if let value = formFieldDefault(field: field) { values[field.key] = value }
        }
    }

    subscript(key: String) -> FormValue? {
        get { values[key] }
        set { values[key] = newValue }
    }

    /// The fields to show now, in the request's order.
    func shown(_ request: FormRequest) -> [FormFieldSpec] {
        request.fields.filter { formFieldShown(field: $0, values: values) }
    }

    /// Shown required fields with nothing in them.
    func missing(_ request: FormRequest) -> [String] {
        shown(request).filter { $0.required && !Self.isFilled(values[$0.key]) }.map(\.key)
    }

    func reply(_ request: FormRequest) -> InteractionReply {
        var answered: [String: FormValue] = [:]
        for field in shown(request) {
            if let value = values[field.key], Self.isFilled(value) { answered[field.key] = value }
        }
        return .form(FormReply(values: answered))
    }

    private static func isFilled(_ value: FormValue?) -> Bool {
        switch value {
        case .text(let text): !text.value.isEmpty
        case .choices(let choices): !choices.values.isEmpty
        case .number, .boolean: true
        case nil: false
        }
    }
}

extension FormFieldSpec {
    var key: String {
        switch self {
        case .string(let field): field.key
        case .number(let field): field.key
        case .integer(let field): field.key
        case .boolean(let field): field.key
        case .multiselect(let field): field.key
        }
    }

    /// The field's title, else its key.
    var label: String {
        let title: String? =
            switch self {
            case .string(let field): field.title
            case .number(let field): field.title
            case .integer(let field): field.title
            case .boolean(let field): field.title
            case .multiselect(let field): field.title
            }
        return title ?? key
    }

    var detail: String? {
        switch self {
        case .string(let field): field.description
        case .number(let field): field.description
        case .integer(let field): field.description
        case .boolean(let field): field.description
        case .multiselect(let field): field.description
        }
    }

    var required: Bool {
        switch self {
        case .string(let field): field.required
        case .number(let field): field.required
        case .integer(let field): field.required
        case .boolean(let field): field.required
        case .multiselect(let field): field.required
        }
    }
}
