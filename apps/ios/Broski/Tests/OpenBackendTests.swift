import BroskiCore
import Foundation
import Testing

@testable import Broski

/// Agents and plans by the contract's open ids: drawn as their bridge describes them, read from
/// their id when it has not, and routed from links, pushes and storage only when the id is valid.
struct OpenBackendTests {
    private func descriptor(
        _ id: String, _ name: String, accent: String? = nil, hint: BackendIconHint? = nil
    ) -> BackendDescriptor {
        BackendDescriptor(
            id: id, displayName: name, accentHex: accent, iconHint: hint,
            capabilities: Capabilities(
                streamText: true, streamThinking: false, promptModes: [.start], attachments: [], commands: false,
                queue: false, interactions: [], thinking: false, children: false, usage: false,
                planProposals: false, externalLive: false, extensions: [], fork: false, rename: false, delete: false))
    }

    @Test func theBuiltInAgentsKeepTheirLogosWithOrWithoutADescriptor() {
        let claude = AgentBrand(descriptor("claude-code", "Claude Code", accent: "#D97757", hint: .claude))
        #expect(claude.logo == .claude && claude.name == "Claude Code")
        #expect(AgentBrand(descriptor("pi", "Pi", hint: .pi)).logo == .pi)
        #expect(AgentBrand(descriptor("pi", "Pi")).logo == .pi, "no hint: the id picks the logo")
        #expect(AgentBrand(backend: "claude-code") == AgentBrand(backend: "claude-code", name: "Claude Code", accentHex: nil, logo: .claude))
        #expect(AgentBrand(backend: "pi").name == "Pi")
        #expect(AgentBrand(descriptor("antigravity", "Antigravity", accent: "#1A73E8", hint: .antigravity)).logo == .antigravity)
        #expect(
            AgentBrand(backend: "antigravity") == AgentBrand(backend: "antigravity", name: "Antigravity", accentHex: nil, logo: .antigravity),
            "a Live Activity the daemon started names only the backend")
    }

    @Test func anyOtherAgentIsItsInitialsOnItsAccent() {
        let codex = AgentBrand(descriptor("codex", "Codex", accent: "#10A37F", hint: .codex))
        #expect(codex.logo == nil && codex.initials == "C")
        #expect(codex.accent == RGB(red: 16.0 / 255, green: 163.0 / 255, blue: 127.0 / 255))

        let mine = AgentBrand(descriptor("my-agent", "  My Agent  ", accent: "#10A37F", hint: .generic))
        #expect(mine.name == "My Agent" && mine.initials == "MA")

        let claudeHinted = AgentBrand(descriptor("claude-code", "Claude Code", hint: .codex))
        #expect(claudeHinted.logo == nil, "a hint the bridge gives wins over the id")
    }

    @Test func anAccentThatIsNoColourAndANameOfNoLettersStillDraw() {
        #expect(AgentBrand(descriptor("x", "X", accent: "#GG0000")).accent == .slate)
        #expect(AgentBrand(descriptor("x", "X", accent: "10A37F")).accent == .slate)
        #expect(AgentBrand(descriptor("x", "X")).accent == .slate)
        #expect(AgentBrand(descriptor("bot", "🤖")).initials == "🤖")
        #expect(AgentBrand(descriptor("bot", " ")).name == "Bot", "a blank name reads the id")
    }

    /// Whichever of white and near black has the higher WCAG contrast ratio on the accent: mid-light
    /// accents, where white falls under 3:1, take dark ink.
    @Test func initialsTakeTheInkThatStandsOutMoreFromTheAccent() throws {
        for light in ["#FFA500", "#22C55E", "#0EA5E9", "#FFFFFF"] {
            #expect(try #require(RGB(hex: light)).prefersDarkInk, "\(light)")
        }
        for dark in ["#16192A", "#333655", "#000000"] {
            #expect(try !#require(RGB(hex: dark)).prefersDarkInk, "\(dark)")
        }
        #expect(!RGB.slate.prefersDarkInk)
    }

    @Test func aLinkOpensASessionOnlyForAValidBackendId() throws {
        let url = try #require(URL(string: "broski://session?machine=m1&backend=my-agent&session=s-1"))
        #expect(SessionTarget(url: url) == SessionTarget(machineId: "m1", session: SessionRef(backend: "my-agent", sessionId: "s-1")))
        for bad in ["My-Agent", "-agent", "a_b", "", String(repeating: "a", count: 65)] {
            var components = URLComponents(string: "broski://session?machine=m1&session=s-1")!
            components.queryItems?.append(URLQueryItem(name: "backend", value: bad))
            #expect(SessionTarget(url: try #require(components.url)) == nil, "\(bad)")
        }
        let repeated = try #require(URL(string: "broski://session?machine=m1&backend=pi&backend=x&session=s"))
        #expect(SessionTarget(url: repeated)?.session.backend == "pi", "a repeated name does not trap")
        #expect(SessionTarget(url: try #require(URL(string: "broski://pair?machine=m1&backend=pi&session=s"))) == nil)
    }

    @Test func aPushOpensACommunityAgentsSessionAndRefusesABadId() {
        let push = PushTarget(["machine": "m1", "backend": "my-agent", "session": "s-1"])
        #expect(push.session == SessionTarget(machineId: "m1", session: SessionRef(backend: "my-agent", sessionId: "s-1")))
        #expect(PushTarget(["machine": "m1", "backend": "../pi", "session": "s-1"]).session == nil)
        #expect(PushTarget(["machine": "m1", "session": "s-1"]).session == nil)
    }

    @Test func aPlanReadsTheBridgesNameElseOneMadeFromItsId() {
        let named = PlanReport(
            PlanMeter(plan: "codex", displayName: "ChatGPT Pro", tier: nil, windows: [], readAt: nil, problem: nil),
            machineName: "Mac")
        #expect(named.plan == UsagePlan(id: "codex") && named.name == "ChatGPT Pro")
        #expect(named.plan.logo == nil)
        let unnamed = PlanReport(
            PlanMeter(plan: "open-router", displayName: nil, tier: nil, windows: [], readAt: nil, problem: nil),
            machineName: "Mac")
        #expect(unnamed.name == "Open Router")
        #expect(UsagePlan.claude.name == "Claude" && UsagePlan.claude.logo == .claude)
    }

    @Test func aStoredReportFromAnEarlierBuildStillReadsAndKeepsItsShape() throws {
        let stored = Data(#"{"plans":[{"plan":"claude","tier":"Max 5x","windows":[],"machineName":"Mac"}],"savedAt":0}"#.utf8)
        let report = try JSONDecoder().decode(UsageReport.self, from: stored)
        #expect(report.plans.map(\.plan) == [.claude] && report.plans[0].name == "Claude")

        var open = report
        open.plans.append(PlanReport(plan: UsagePlan(id: "codex"), displayName: "Codex", windows: [], machineName: "Mac"))
        let encoded = try JSONEncoder().encode(open)
        let plans = try #require(
            (try JSONSerialization.jsonObject(with: encoded) as? [String: Any])?["plans"] as? [[String: Any]])
        #expect(plans.map { $0["plan"] as? String } == ["claude", "codex"], "a plan is stored as its bare id")
        #expect(try JSONDecoder().decode(UsageReport.self, from: encoded) == open)
    }

    @Test func plansMergeByIdInTheOrderTheMacsGaveThemTheNewerReadingWinning() {
        let old = Date(timeIntervalSince1970: 1)
        let new = Date(timeIntervalSince1970: 2)
        let merged = UsageModel.merged([
            PlanReport(plan: UsagePlan(id: "codex"), windows: [], readAt: old, machineName: "A"),
            PlanReport(plan: .claude, windows: [], readAt: old, machineName: "A"),
            PlanReport(plan: UsagePlan(id: "codex"), windows: [], readAt: new, machineName: "B"),
        ])
        #expect(merged.map(\.plan.id) == ["codex", "claude"])
        #expect(merged.map(\.machineName) == ["B", "A"])
    }
}
