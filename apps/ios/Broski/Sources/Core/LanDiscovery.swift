import Darwin
import Foundation
import Network
import Observation
import dnssd
import os

/// Browses the local network for paired machines' `_broski-link._tcp` advertisements
/// (`packages/link/daemon/src/discovery.rs`: TXT `id` is the machine id, `v` the version) and
/// reports each one's IPv4 or IPv6 `host:port` (including scoped link-local `[fe80::...%if]:port`
/// for iOS Personal Hotspot) to `Machine.lanDiscovered(routes:)`.
@Observable
final class LanDiscovery {
    static let serviceType = "_broski-link._tcp"
    private static let version = "1"
    private static let resolveTimeout: Duration = .seconds(5)

    private(set) var denied = false

    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var resolving: [NWEndpoint: NWConnection] = [:]
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

    /// Restarts an active browse when the phone moves between Wi-Fi, Cellular, or Personal Hotspot.
    func networkChanged() {
        guard browser != nil else { return }
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

    /// Network framework resolves a service via Happy Eyeballs across both IPv4 and IPv6 (including
    /// hotspot link-local and delegated `/64` IPv6); once connected, the winning route is reported
    /// and this probe connection closes immediately.
    private func resolve(_ endpoint: NWEndpoint, machineId: String) {
        guard resolving[endpoint] == nil else { return }
        let connection = NWConnection(to: endpoint, using: .tcp)
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
            if let route = Self.route(from: connection.currentPath) {
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

    private static func route(from path: NWPath?) -> String? {
        guard case .hostPort(let host, let port) = path?.remoteEndpoint else { return nil }
        switch host {
        case .ipv4(let address):
            let bytes = Array(address.rawValue)
            guard bytes.count == 4, !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 0 && bytes[3] <= 7) else {
                return nil
            }
            return "\(bytes.map(String.init).joined(separator: ".")):\(port.rawValue)"
        case .ipv6(let address):
            guard let text = formatIPv6(address.rawValue) else { return nil }
            if address.isLinkLocal {
                guard let zone = address.interface?.name ?? path?.availableInterfaces.first?.name, !zone.isEmpty else {
                    return nil
                }
                return "[\(text)%\(zone)]:\(port.rawValue)"
            }
            return "[\(text)]:\(port.rawValue)"
        default:
            return nil
        }
    }

    private static func formatIPv6(_ raw: Data) -> String? {
        guard raw.count == MemoryLayout<in6_addr>.size else { return nil }
        var addr = in6_addr()
        _ = withUnsafeMutableBytes(of: &addr) { raw.copyBytes(to: $0) }
        var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
        guard inet_ntop(AF_INET6, &addr, &buffer, socklen_t(INET6_ADDRSTRLEN)) != nil else { return nil }
        return buffer.withUnsafeBufferPointer { ptr in
            ptr.baseAddress.map { String(cString: $0) }
        }
    }

    private func finishResolving(_ connection: NWConnection, of endpoint: NWEndpoint) {
        if resolving[endpoint] === connection { resolving[endpoint] = nil }
        connection.cancel()
    }
}
