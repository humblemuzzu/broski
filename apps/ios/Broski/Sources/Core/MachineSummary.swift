import BroskiCore
import Foundation

/// What the UI says about one machine, read from its `MachineStatus` alone: the link first, then,
/// on a connected link, the daemon's bridge and the contract.
struct MachineSummary: Equatable {
    enum Health: Equatable {
        /// Connected, the bridge up and the protocol agreed.
        case ready
        /// On its way there by itself: connecting, reconnecting, the bridge starting.
        case settling
        /// Waiting on something the person may need to act on.
        case attention
        /// Removed from the machine; only a new pairing helps.
        case revoked
    }

    let health: Health
    /// The full sentence for the Machines screen.
    let line: String
    /// The short chip the inbox header shows; `nil` when there is nothing to say there.
    let chip: String?
    let canRestartBridge: Bool

    var isReady: Bool { health == .ready }

    init(name: String, status: MachineStatus) {
        switch status.link.state {
        case .connecting:
            self.init(.settling, "Connecting…", chip: "Connecting to \(name)…")
        case .connected:
            self.init(name: name, route: status.link.route, bridge: status.bridge, contract: status.contract)
        case .waiting(.retry):
            self.init(.settling, "Reconnecting…", chip: "Reconnecting to \(name)…")
        case .waiting(.paused):
            self.init(.settling, "Paused while Broski is in the background", chip: nil)
        case .waiting(.machineOffline):
            self.init(.attention, "\(name) is offline", chip: "\(name) offline")
        case .waiting(.machineAsleep):
            self.init(.attention, "\(name) is asleep", chip: "\(name) asleep")
        case .waiting(.relayRefused):
            self.init(
                .attention, "The relay hasn't accepted this phone yet. Broski keeps trying.",
                chip: "\(name): relay refused")
        case .revoked:
            self.init(
                .revoked, "This phone was removed from \(name). Pair again to use it.",
                chip: "\(name) revoked — pair again")
        case .closed:
            self.init(.attention, "Disconnected", chip: "\(name) disconnected")
        }
    }

    private init(name: String, route: LinkRoute?, bridge: BridgeStatus?, contract: ContractState) {
        switch bridge?.state {
        case .down:
            self.init(.attention, "The bridge on \(name) is down", chip: "\(name): bridge down", restart: true)
            return
        case .crashed:
            self.init(.attention, "The bridge on \(name) crashed", chip: "\(name): bridge crashed", restart: true)
            return
        case .starting, .connecting:
            self.init(.settling, "The bridge is starting…", chip: "Starting \(name)'s bridge…")
            return
        case .up, .unknown, nil:
            break
        }
        switch contract {
        case .ready:
            self.init(.ready, route == .lan ? "Connected on this network" : "Connected through the relay", chip: nil)
        case .waiting:
            self.init(.settling, "Getting ready…", chip: "Connecting to \(name)…")
        case .refused(let message):
            self.init(.attention, "The bridge turned this phone away: \(message)", chip: "\(name): refused")
        case .incompatible(let message):
            self.init(.attention, "Broski and this bridge need the same version: \(message)", chip: "\(name) needs an update")
        }
    }

    private init(_ health: Health, _ line: String, chip: String?, restart: Bool = false) {
        self.health = health
        self.line = line
        self.chip = chip
        canRestartBridge = restart
    }
}
