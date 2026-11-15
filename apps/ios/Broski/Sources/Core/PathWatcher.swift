import Network

/// Calls `changed` when the phone's network path changes: it comes or goes, or moves to other
/// interfaces. The path the monitor reports at its start is not a change.
final class PathWatcher {
    private struct Shape: Equatable {
        let satisfied: Bool
        let interfaces: [String]

        init(_ path: NWPath) {
            satisfied = path.status == .satisfied
            interfaces = path.availableInterfaces.map(\.name)
        }
    }

    private let monitor = NWPathMonitor()
    private var current: Shape?

    init(changed: @escaping @MainActor () -> Void) {
        monitor.pathUpdateHandler = { [weak self] path in
            MainActor.assumeIsolated {
                guard let self else { return }
                let shape = Shape(path)
                defer { self.current = shape }
                if let current = self.current, current != shape { changed() }
            }
        }
        monitor.start(queue: .main)
    }

    deinit {
        monitor.cancel()
    }
}
