import Foundation
import Observation

/// The models the person pinned for each agent, in the order pinned, and the thinking level they
/// last chose on each model, kept on this phone. Keyed by backend and model id, not by Mac: the
/// same agent on two Macs usually lists the same models, and a pin whose model a Mac does not list
/// is only hidden there.
@Observable
final class ModelPreferences {
    static let pinLimit = 10

    private var pins: [String: [String]]
    private var levels: [String: [String: String]]
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        pins = Self.read(Preference.modelPins, from: defaults) ?? [:]
        levels = Self.read(Preference.modelLevels, from: defaults) ?? [:]
    }

    func pinned(backend: String) -> [String] {
        pins[backend] ?? []
    }

    func isPinned(_ modelId: String, backend: String) -> Bool {
        pinned(backend: backend).contains(modelId)
    }

    func canPin(backend: String) -> Bool {
        pinned(backend: backend).count < Self.pinLimit
    }

    func setPinned(_ pin: Bool, _ modelId: String, backend: String) {
        var list = pinned(backend: backend)
        if pin {
            guard !list.contains(modelId), list.count < Self.pinLimit else { return }
            list.append(modelId)
        } else {
            list.removeAll { $0 == modelId }
        }
        pins[backend] = list.isEmpty ? nil : list
        write(pins, Preference.modelPins)
    }

    func level(of modelId: String, backend: String) -> String? {
        levels[backend]?[modelId]
    }

    func remember(level: String, of modelId: String, backend: String) {
        guard levels[backend]?[modelId] != level else { return }
        levels[backend, default: [:]][modelId] = level
        write(levels, Preference.modelLevels)
    }

    private func write(_ value: some Encodable, _ key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }

    private static func read<T: Decodable>(_ key: String, from defaults: UserDefaults) -> T? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }
}
