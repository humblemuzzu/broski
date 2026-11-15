import BroskiCore

nonisolated extension JsonValue {
    subscript(key: String) -> JsonValue? {
        guard case .object(let members) = self else { return nil }
        return members.first { $0.key == key }?.value
    }

    var string: String? {
        if case .string(let text) = self { text } else { nil }
    }

    /// The first of `keys` that holds text.
    func text(_ keys: [String]) -> String? {
        keys.lazy.compactMap { self[$0]?.string }.first { !$0.isEmpty }
    }

    /// The value as a person reads it: text as written, numbers without a needless fraction, and
    /// anything nested as compact JSON.
    var display: String {
        switch self {
        case .null: "null"
        case .bool(let value): value ? "true" : "false"
        case .number(let value): value.rounded() == value && abs(value) < 1e15 ? String(Int64(value)) : String(value)
        case .string(let text): text
        case .array(let values): "[" + values.map(\.json).joined(separator: ", ") + "]"
        case .object: json
        }
    }

    /// One `key: value` line per member of an object; anything else as one line.
    var argumentLines: [String] {
        guard case .object(let members) = self else { return [display] }
        return members.map { "\($0.key): \($0.value.display)" }
    }

    private var json: String {
        switch self {
        case .string(let text): "\"\(text)\""
        case .object(let members): "{" + members.map { "\"\($0.key)\": \($0.value.json)" }.joined(separator: ", ") + "}"
        default: display
        }
    }
}
