import BroskiCore

/// A form's values as the person fills them in, starting from each shown field's default. A field
/// shows while its `when` conditions hold (`field-check.ts`' `fieldIsActive`), and only shown
/// fields are sent.
struct FormDraft: Equatable {
    private(set) var values: [String: FormValue] = [:]

    init(_ request: FormRequest) {
        for field in request.fields where !field.hidden {
            if let value = field.defaultFormValue { values[field.key] = value }
        }
    }

    subscript(key: String) -> FormValue? {
        get { values[key] }
        set { values[key] = newValue }
    }

    /// The fields to show now, in the request's order.
    func shown(_ request: FormRequest) -> [FormFieldSpec] {
        request.fields.filter { !$0.hidden && isActive($0) }
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

    func isActive(_ field: FormFieldSpec) -> Bool {
        field.when.allSatisfy { condition in
            guard let answer = values[condition.key] else { return false }
            let matches: Bool =
                switch (answer, condition.value) {
                case (.choices(let choices), .text(let expected)): choices.values.contains(expected.value)
                case (.choices, _): false
                case (.text(let a), .text(let b)): a.value == b.value
                case (.number(let a), .number(let b)): a.value == b.value
                case (.boolean(let a), .boolean(let b)): a.value == b.value
                default: false
                }
            return condition.op == .eq ? matches : !matches
        }
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

    var hidden: Bool {
        switch self {
        case .string(let field): field.hidden
        case .number(let field): field.hidden
        case .integer(let field): field.hidden
        case .boolean(let field): field.hidden
        case .multiselect(let field): field.hidden
        }
    }

    var when: [FieldCondition] {
        switch self {
        case .string(let field): field.when
        case .number(let field): field.when
        case .integer(let field): field.when
        case .boolean(let field): field.when
        case .multiselect(let field): field.when
        }
    }

    var defaultFormValue: FormValue? {
        switch self {
        case .string(let field): field.defaultValue.map { .text(TextValue(value: $0)) }
        case .number(let field): field.defaultValue.map { .number(NumberValue(value: $0)) }
        case .integer(let field): field.defaultValue.map { .number(NumberValue(value: Double($0))) }
        case .boolean(let field): field.defaultValue.map { .boolean(BooleanValue(value: $0)) }
        case .multiselect(let field): field.defaultValue.map { .choices(ChoicesValue(values: $0)) }
        }
    }
}
