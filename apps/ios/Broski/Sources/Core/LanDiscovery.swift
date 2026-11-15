import Foundation
import Network
import Observation
import dnssd
import os

/// Browses the local network for paired machines' `_broski-link._tcp` advertisements
/// (`packages/link/daemon/src/discovery.rs`: TXT `id` is the machine id, `v` the version) and
/// reports each one's IPv4 `host:port` for `Machine.lanDiscovered(routes:)`.
///
/// Browsing needs the Local Network permission, which iOS asks for the first time a browse starts;
/// the app starts one only once a pairing exists. Without it the relay carries every link.
@Observable
final class LanDiscovery {
    static let serviceType = "_broski-link._tcp"
    private static let version = "1"
    private static let resolveTimeout: Duration = .seconds(5)

    /// The person turned Local Network off for Broski.
    private(set) var denied = false

    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var resolving: [NWEndpoint: NWConnection] = [:]
    /// Takes each machine id and `host:port` found.
    @ObservationIgnored var found: (_ machineId: String, _ route: String) -> Void = { _, _ in }

    var isRunning: Bool { browser != nil }

    func start() {
        guard browser == nil else { return }
        let parameters = NWParameters()
        parameters.includePeerToPeer = false
        let browser = NWBrowser(
            for: .bonjourWithTXTRecord(type: Self.serviceType, domain: "local."), using: parameters)
        browser.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated { self?.browserChanged(state) }
        }
        browser.browseResultsChangedHandler = { [weak self] _, changes in
            MainActor.assumeIsolated { self?.resultsChanged(changes) }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
        resolving.values.forEach { $0.cancel() }
        resolving.removeAll()
    }

    /// A failed browse starts again on the next network change.
    func networkChanged() {
        guard let browser, case .failed = browser.state else { return }
        stop()
        start()
    }

    private func browserChanged(_ state: NWBrowser.State) {
        switch state {
        case .ready:
            denied = false
        case .waiting(let error), .failed(let error):
            denied = error == .dns(DNSServiceErrorType(kDNSServiceErr_PolicyDenied))
        case .setup, .cancelled:
            break
        @unknown default:
            break
        }
    }

    private func resultsChanged(_ changes: Set<NWBrowser.Result.Change>) {
        for change in changes {
            switch change {
            case .added(let result), .changed(_, let result, _):
                if let machineId = Self.machineId(of: result) { resolve(result.endpoint, machineId: machineId) }
            case .removed, .identical:
                break
            @unknown default:
                break
            }
        }
    }

    private static func machineId(of result: NWBrowser.Result) -> String? {
        guard case .bonjour(let txt) = result.metadata, txt["v"] == version, let id = txt["id"], !id.isEmpty
        else { return nil }
        return id
    }

    /// Network framework resolves a service by connecting to it; the address it connected to is the
    /// route, and the connection closes at once. IPv4 only: the core's routes carry no IPv6 zone.
    private func resolve(_ endpoint: NWEndpoint, machineId: String) {
        guard resolving[endpoint] == nil else { return }
        let parameters = NWParameters.tcp
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let connection = NWConnection(to: endpoint, using: parameters)
        resolving[endpoint] = connection
        connection.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated { self?.resolution(by: connection, machineId: machineId, changed: state) }
        }
        connection.start(queue: .main)
        Task { [weak self] in
            try? await Task.sleep(for: Self.resolveTimeout)
            self?.finishResolving(connection, of: endpoint)
        }
    }

    private func resolution(by connection: NWConnection, machineId: String, changed state: NWConnection.State) {
        switch state {
        case .ready:
            if case .hostPort(.ipv4(let address), let port) = connection.currentPath?.remoteEndpoint {
                let route = "\(address.rawValue.map(String.init).joined(separator: ".")):\(port.rawValue)"
                Logger.core.info("machine \(machineId, privacy: .public) found on the LAN at \(route, privacy: .public)")
                found(machineId, route)
            }
            finishResolving(connection, of: connection.endpoint)
        case .failed, .waiting:
            finishResolving(connection, of: connection.endpoint)
        case .setup, .preparing, .cancelled:
            break
        @unknown default:
            break
        }
    }

    /// Ends this connection only: a later resolve of the same endpoint has its own, which the
    /// timer of an earlier one must not cancel.
    private func finishResolving(_ connection: NWConnection, of endpoint: NWEndpoint) {
        if resolving[endpoint] === connection { resolving[endpoint] = nil }
        connection.cancel()
    }
}
