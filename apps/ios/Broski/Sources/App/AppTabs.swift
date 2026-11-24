import BroskiCore
import SwiftUI
import ThinkingOrbsKit

enum AppTab: Hashable {
    case inbox
    case usage
    case settings
    /// The round button at the bar's trailing end. It is never selected: it opens New Session on
    /// the inbox.
    case newSession
}

/// The tab shell: a Liquid Glass tab bar that minimises as the content scrolls down, with New
/// Session as the round button beside it, and, while any agent works, an accessory above it that
/// opens the inbox filtered to working.
struct AppTabs: View {
    @Environment(AppModel.self) private var model
    @State private var tab: AppTab = .inbox

    var body: some View {
        TabView(selection: selection) {
            Tab(value: .inbox) {
                InboxScreen()
            } label: {
                TabIcon("Inbox", symbol: "text.bubble")
            }
            .badge(model.inbox.rows.count { $0.state == .needsYou })

            Tab(value: .usage) {
                UsageScreen()
            } label: {
                TabIcon("Usage", symbol: "chart.bar")
            }

            Tab(value: .settings) {
                SettingsScreen()
            } label: {
                TabIcon("Settings", symbol: "gearshape")
            }

            Tab(value: .newSession, role: Self.composeRole) {
                Color.clear
            } label: {
                TabIcon("New Session", symbol: "square.and.pencil")
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .onChange(of: model.sessionToOpen) { _, target in
            if target != nil { tab = .inbox }
        }
        .onChange(of: model.screenMachineToOpen) { _, machineId in
            if machineId != nil { tab = .inbox }
        }
        .onChange(of: model.startsNewSession) { _, starts in
            if starts { tab = .inbox }
        }
        .onChange(of: model.opensUsage, initial: true) { _, opens in
            guard opens else { return }
            model.opensUsage = false
            tab = .usage
        }
        .modifier(WorkingAccessory(count: tab != .inbox || model.inboxAtRoot ? model.inbox.workingCount : 0) {
            tab = .inbox
            model.inbox.filter.state = .working
        })
    }

    /// iOS 27 sets an action apart from the bar as its prominent tab; iOS 26 does that only for search.
    private static var composeRole: TabRole {
        if #available(iOS 27.0, *) { .prominent } else { .search }
    }

    private var selection: Binding<AppTab> {
        Binding {
            tab
        } set: { picked in
            if picked == .newSession {
                model.startsNewSession = true
            } else {
                tab = picked
            }
        }
    }
}

/// "n agents working" in the tab view's bottom accessory, left out while the inbox shows a screen
/// pushed over its list (a chat, New Session, a session's files), each of which hides the tab bar. Showing and hiding it in place needs
/// `tabViewBottomAccessory(isEnabled:)` (iOS 26.1); on 26.0 the accessory is left out.
private struct WorkingAccessory: ViewModifier {
    let count: Int
    let open: () -> Void

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: count > 0) {
                WorkingAccessoryLabel(count: count, open: open)
            }
        } else {
            content
        }
    }
}

/// A tab drawn as its symbol alone, at the size it has beside a title (the bar draws a bare symbol
/// larger); VoiceOver and the UI tests read its name.
private struct TabIcon: View {
    let name: String
    let symbol: String

    init(_ name: String, symbol: String) {
        self.name = name
        self.symbol = symbol
    }

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .medium))
            .accessibilityLabel(name)
    }
}

private struct WorkingAccessoryLabel: View {
    let count: Int
    let open: () -> Void
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        Button(action: open) {
            HStack(spacing: Spacing.s) {
                Orb(.working, side: 18, relativeTo: .footnote)
                Text("^[\(count) agent](inflect: true) working")
                    .font(placement == .inline ? .footnote.weight(.semibold) : .subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 0)
                if placement != .inline {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, Spacing.l)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Shows the sessions that are working")
    }
}
