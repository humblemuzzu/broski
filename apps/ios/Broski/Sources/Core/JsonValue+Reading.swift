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
}
