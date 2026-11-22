import BroskiCore
import SwiftUI

/// The folders this Mac's sessions ran in, newest first, the chosen one lit; then All Projects for
/// the rest and for any folder on the Mac. One glass card above the composer.
struct ProjectList: View {
    let projects: [Project]
    let selected: String?
    let home: String?
    let pick: (String) -> Void
    let browse: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(projects) { project in
                Button { pick(project.path) } label: {
                    ProjectRow(project: project, detail: detail(project), isSelected: project.path == selected)
                }
                .buttonStyle(.plain)
            }
            Button(action: browse) {
                ChooserRow(isSelected: false) {
                    Image(systemName: projects.isEmpty ? "folder.badge.plus" : "magnifyingglass")
                        .foregroundStyle(.secondary)
                } title: {
                    Text(projects.isEmpty ? "Choose a Folder…" : "All Projects")
                        .foregroundStyle(projects.isEmpty ? Palette.accent : .primary)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(Spacing.xs)
        .glassEffect(.regular, in: .rect(cornerRadius: 26, style: .continuous))
    }

    /// Two folders of one name tell themselves apart by where they are.
    private func detail(_ project: Project) -> String? {
        guard projects.contains(where: { $0 != project && $0.name == project.name }) else { return nil }
        return project.path.parentPath.abbreviatingHome(home)
    }
}

private struct ProjectRow: View {
    let project: Project
    let detail: String?
    let isSelected: Bool

    var body: some View {
        ChooserRow(isSelected: isSelected) {
            Image(systemName: isSelected ? "folder.fill" : "folder")
                .foregroundStyle(isSelected ? Palette.accent : .secondary)
        } title: {
            VStack(alignment: .leading, spacing: 0) {
                Text(project.name)
                    .fontWeight(isSelected ? .semibold : .regular)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .truncationMode(.head)
                }
            }
            .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(["Folder", project.name, detail].compactMap(\.self).joined(separator: ", "))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// A row of the card: its icon in a fixed column, the title, the selection as a soft fill.
private struct ChooserRow<Icon: View, Title: View>: View {
    let isSelected: Bool
    @ViewBuilder let icon: () -> Icon
    @ViewBuilder let title: () -> Title
    @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 26

    var body: some View {
        HStack(spacing: Spacing.m) {
            icon().frame(width: iconWidth)
            title()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s + 2)
        .frame(minHeight: 44)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: 22, style: .continuous).fill(.primary.opacity(0.08))
            }
        }
        .contentShape(.rect)
    }
}

/// The agent and the folder the session starts with, as two capsules over the composer. The agent
/// is a menu, where one that cannot run says why; the folder opens and closes the list above.
struct SessionPills: View {
    let machine: MachineModel
    let backend: String?
    let folder: String?
    let showsProjects: Bool
    let pickBackend: (String) -> Void
    let toggleProjects: () -> Void

    private var brand: AgentBrand? { backend.map(machine.brand(for:)) }

    var body: some View {
        HStack(spacing: Spacing.s) {
            Menu {
                ForEach(machine.backends, id: \.id) { descriptor in
                    Button { pickBackend(descriptor.id) } label: {
                        Text(AgentBrand(descriptor).name)
                        if let reason = reason(descriptor.id) { Text(reason) }
                        if descriptor.id == backend { Image(systemName: "checkmark") }
                    }
                    .disabled(!machine.canRun(descriptor.id))
                }
            } label: {
                PillLabel {
                    if let brand {
                        AgentLogo(brand: brand, side: 20)
                    }
                    Text(brand?.name ?? "Agent")
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .glassEffect(.regular.interactive(), in: .capsule)
            .accessibilityLabel("Agent, \(brand?.name ?? "none")")

            Button(action: toggleProjects) {
                PillLabel {
                    Image(systemName: "folder.fill")
                        .foregroundStyle(Palette.accent)
                    Text(folder?.lastPathComponent ?? "Choose a folder")
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Image(systemName: showsProjects ? "chevron.down" : "chevron.up")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .accessibilityLabel(folder.map { "Starts in \($0.lastPathComponent)" } ?? "Choose a folder")
            .accessibilityHint(showsProjects ? "Hides the folders" : "Shows the folders")

            Spacer(minLength: 0)
        }
    }

    /// Why the agent cannot run: not installed, signed out, or its own words.
    private func reason(_ backend: String) -> String? {
        guard let status = machine.backendStatuses[backend], !status.usable else { return nil }
        if !status.installed { return "Not installed on \(machine.name)" }
        if status.auth == .signedOut { return "Signed out on \(machine.name)" }
        return status.issues.first?.message ?? "Can't run right now"
    }
}

private struct PillLabel<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: Spacing.xs + 2) {
            content()
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.primary)
        .padding(.horizontal, Spacing.m)
        .frame(minHeight: 36)
        .contentShape(.capsule)
    }
}
