import BroskiCore
import Testing

@testable import Broski

struct MachineSummaryTests {
    private func status(
        _ state: LinkState, route: LinkRoute? = nil, bridge: BridgeState? = nil, contract: ContractState = .waiting
    ) -> MachineStatus {
        MachineStatus(
            link: LinkStatus(state: state, route: route, routeDetail: nil, lastSeenMs: nil, closeCode: nil),
            bridge: bridge.map { BridgeStatus(state: $0, conn: 1, detail: nil) }, contract: contract)
    }

    private let connected = LinkState.connected(resumed: false, sessionReset: false)

    @Test func aHostNameReadsAsWordsAndAChosenNameAsWritten() {
        #expect(MachineName.display("Studio-MacBook-Pro-5.local") == "Studio MacBook Pro 5")
        #expect(MachineName.display("studio.LOCAL") == "studio")
        #expect(MachineName.display("Sam's MacBook-Pro") == "Sam's MacBook-Pro")
        #expect(MachineName.display(".local") == ".local")
    }

    @Test func aReadyMachineSaysHowItIsConnectedAndShowsNoChip() {
        let lan = MachineSummary(name: "Mac", status: status(connected, route: .lan, bridge: .up, contract: .ready(bridgeVersion: "1.0")))
        #expect(lan.isReady && lan.chip == nil && lan.line == "Connected on this network")
        let relay = MachineSummary(name: "Mac", status: status(connected, route: .relay, bridge: .up, contract: .ready(bridgeVersion: "1.0")))
        #expect(relay.line == "Connected through the relay")
    }

    @Test func theBridgeOnAConnectedLinkDecidesBeforeTheContract() {
        for state: BridgeState in [.down, .crashed] {
            let summary = MachineSummary(name: "Mac", status: status(connected, route: .lan, bridge: state))
            #expect(summary.health == .attention && summary.canRestartBridge)
        }
        let starting = MachineSummary(name: "Mac", status: status(connected, bridge: .starting, contract: .ready(bridgeVersion: "1.0")))
        #expect(starting.health == .settling && !starting.canRestartBridge)
        let incompatible = MachineSummary(name: "Mac", status: status(connected, bridge: .up, contract: .incompatible(message: "major 2")))
        #expect(incompatible.health == .attention && incompatible.line.hasSuffix("major 2"))
    }

    @Test func aLinkThatIsNotConnectedSaysWhyInTheDesignsWords() {
        #expect(MachineSummary(name: "MacBook", status: status(.waiting(.machineOffline))).chip == "MacBook offline")
        #expect(MachineSummary(name: "MacBook", status: status(.waiting(.retry))).health == .settling)
        #expect(MachineSummary(name: "MacBook", status: status(.waiting(.paused))).chip == nil)
        let revoked = MachineSummary(name: "MacBook", status: status(.revoked))
        #expect(revoked.health == .revoked && revoked.chip == "MacBook revoked — pair again")
        #expect(!MachineSummary(name: "MacBook", status: status(.waiting(.retry), bridge: .down)).canRestartBridge)
    }
}
