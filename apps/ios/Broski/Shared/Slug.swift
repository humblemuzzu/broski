/// The contract's open ids for agents and plans: `claude-code`, `pi`, `my-agent`, `antigravity`.
nonisolated enum Slug {
    /// Whether `value` is one the contract allows, for an id that arrives from a link, a push or storage.
    static func isValid(_ value: String) -> Bool {
        value.wholeMatch(of: /[a-z0-9][a-z0-9-]{0,63}/) != nil
    }

    /// What the phone calls an id nothing named: "my-agent" reads "My Agent".
    static func label(_ slug: String) -> String {
        slug.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
}
