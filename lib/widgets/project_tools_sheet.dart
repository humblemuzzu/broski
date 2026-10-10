import 'package:broski/models/agent_type.dart';
import 'package:broski/models/project.dart';
import 'package:broski/screens/claude_code_commands_screen.dart';
import 'package:broski/screens/claude_code_mcp_screen.dart';
import 'package:broski/screens/claude_code_memory_screen.dart';
import 'package:broski/screens/claude_code_settings_screen.dart';
import 'package:broski/screens/codex_agents_screen.dart';
import 'package:broski/screens/codex_mcp_screen.dart';
import 'package:broski/screens/custom_tools_screen.dart';
import 'package:broski/screens/hooks_screen.dart';
import 'package:broski/screens/mcp_servers_screen.dart';
import 'package:broski/screens/opencode_agents_screen.dart';
import 'package:broski/screens/opencode_commands_screen.dart';
import 'package:broski/screens/opencode_plugins_screen.dart';
import 'package:broski/screens/opencode_workspaces_screen.dart';
import 'package:broski/screens/opencode_worktrees_screen.dart';
import 'package:broski/screens/plugins_screen.dart';
import 'package:broski/screens/projects_screen.dart';
import 'package:broski/screens/sheets/cx_apps_sheet.dart';
import 'package:broski/screens/skills_screen.dart';
import 'package:broski/screens/subagents_screen.dart';
import 'package:broski/screens/tools_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';

/// Shows a project tools sheet using DetailSheet.
Future<void> showProjectToolsSheet({
  required BuildContext context,
  required AgentType backend,
  required ProjectSummary project,
}) {
  final backendLabel = backend.displayName;
  return DetailSheet.show(
    context: context,
    title: 'Project Tools',
    initialSize: 0.75,
    maxSize: 0.9,
    minSize: 0.4,
    trailing: Text(backendLabel, style: const TextStyle(fontSize: 11)),
    child: _ProjectToolsContent(backend: backend, project: project),
  );
}

/// Legacy widget for backwards compatibility.
/// Prefer using [showProjectToolsSheet] instead.
class ProjectToolsSheet extends StatelessWidget {
  const ProjectToolsSheet({
    required this.backend,
    required this.project,
    super.key,
  });
  final AgentType backend;
  final ProjectSummary project;
  @override
  Widget build(BuildContext context) {
    final backendLabel = backend.displayName;
    return DetailSheet(
      title: 'Project Tools',
      trailing: Text(backendLabel, style: const TextStyle(fontSize: 11)),
      child: SingleChildScrollView(
        child: _ProjectToolsContent(backend: backend, project: project),
      ),
    );
  }
}

/// The actual content of the project tools sheet.
class _ProjectToolsContent extends StatelessWidget {
  const _ProjectToolsContent({required this.backend, required this.project});
  final AgentType backend;
  final ProjectSummary project;
  void _closeAndPush(BuildContext context, Widget screen) {
    final nav = Navigator.of(context);
    nav.pop();
    Future.delayed(const Duration(milliseconds: 150), () {
      nav.push(MaterialPageRoute(builder: (_) => screen));
    });
  }

  Widget _sectionLabel(OpenCodeTheme theme, String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 10),
      child: SectionHeader(title: text.toUpperCase(), theme: theme),
    );
  }

  Widget _tile(
    BuildContext context,
    OpenCodeTheme theme, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    Color? color,
  }) {
    final effectiveColor = color ?? theme.text;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.brLg,
        child: Container(
          padding: Insets.cardMd,
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brLg,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Row(
            children: [
              Container(
                padding: Insets.cardXs,
                decoration: BoxDecoration(
                  color: effectiveColor.withValues(alpha: 0.12),
                  borderRadius: Radii.brMd,
                ),
                child: Icon(icon, size: 18, color: effectiveColor),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: theme.text,
                      ),
                    ),
                    const SizedBox(height: Spacing.xxs),
                    Text(
                      subtitle,
                      style: AppTypography.label(color: theme.textMuted),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Icon(AppIcons.chevronRight, size: 20, color: theme.textMuted),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final projectPath = project.path;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Project path info
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Text(
            projectPath.isEmpty ? 'No project path' : projectPath,
            style: AppTypography.label(color: theme.textMuted),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        // Navigation section
        _sectionLabel(theme, 'Navigation'),
        _tile(
          context,
          theme,
          icon: AppIcons.folderOpen,
          title: 'Projects',
          subtitle: 'Open your project list',
          onTap: () => _closeAndPush(context, const ProjectsScreen()),
          color: theme.accent,
        ),
        // Backend-specific sections
        if (backend == AgentType.opencode) ...[
          _sectionLabel(theme, 'Power features'),
          _tile(
            context,
            theme,
            icon: AppIcons.autoFix,
            title: 'Skills',
            subtitle: 'Project + user skills',
            onTap: () => _closeAndPush(
              context,
              const SkillsScreen(backend: AgentType.opencode),
            ),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.bolt,
            title: 'Commands',
            subtitle: '.opencode/commands',
            onTap: () => _closeAndPush(context, const OpenCodeCommandsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.agent,
            title: 'Agents',
            subtitle: '.opencode/agent',
            onTap: () => _closeAndPush(context, const OpenCodeAgentsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.dns,
            title: 'MCP Servers',
            subtitle: 'Model Context Protocol',
            onTap: () => _closeAndPush(context, const McpServersScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.handyman,
            title: 'Tools',
            subtitle: 'Enabled tools + formatters',
            onTap: () => _closeAndPush(context, const ToolsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.extension_,
            title: 'Plugins',
            subtitle: '.opencode/plugin',
            onTap: () => _closeAndPush(context, const OpenCodePluginsScreen()),
          ),
          _sectionLabel(theme, 'Environments'),
          _tile(
            context,
            theme,
            icon: AppIcons.gitBranch,
            title: 'Worktrees',
            subtitle: 'Parallel git branches for agents',
            onTap: () =>
                _closeAndPush(context, const OpenCodeWorktreesScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.workspace,
            title: 'Workspaces',
            subtitle: 'Isolated runtime environments',
            onTap: () =>
                _closeAndPush(context, const OpenCodeWorkspacesScreen()),
          ),
        ] else if (backend == AgentType.claudeCode) ...[
          _sectionLabel(theme, 'Power features'),
          _tile(
            context,
            theme,
            icon: AppIcons.autoFix,
            title: 'Skills',
            subtitle: 'Project + user skills',
            onTap: () => _closeAndPush(
              context,
              const SkillsScreen(backend: AgentType.claudeCode),
            ),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.bolt,
            title: 'Commands',
            subtitle: '.claude/commands',
            onTap: () =>
                _closeAndPush(context, const ClaudeCodeCommandsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.link,
            title: 'Hooks',
            subtitle: 'Project + user hooks',
            onTap: () => _closeAndPush(context, const HooksScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.hub,
            title: 'MCP',
            subtitle: 'Project + user MCP config',
            onTap: () => _closeAndPush(context, const ClaudeCodeMcpScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.agent,
            title: 'Subagents',
            subtitle: 'Custom subagent definitions',
            onTap: () => _closeAndPush(context, const SubagentsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.memory,
            title: 'Memory',
            subtitle: 'Agent memory scopes and status',
            onTap: () => _closeAndPush(context, const ClaudeCodeMemoryScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.extension_,
            title: 'Custom Tools',
            subtitle: 'HTTP APIs, scripts, and more',
            onTap: () => _closeAndPush(context, const CustomToolsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.extensionOff,
            title: 'Plugins',
            subtitle: 'Commands, skills, hooks, MCP',
            onTap: () => _closeAndPush(context, const PluginsScreen()),
          ),
          _sectionLabel(theme, 'Configuration'),
          _tile(
            context,
            theme,
            icon: AppIcons.tune,
            title: 'Claude Code Settings',
            subtitle: 'Tools, permissions, system prompt',
            onTap: () =>
                _closeAndPush(context, const ClaudeCodeSettingsScreen()),
          ),
        ] else if (backend == AgentType.codex) ...[
          _sectionLabel(theme, 'Power features'),
          _tile(
            context,
            theme,
            icon: AppIcons.autoFix,
            title: 'Skills',
            subtitle: 'Repo + user skills',
            onTap: () => _closeAndPush(
              context,
              const SkillsScreen(backend: AgentType.codex),
            ),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.agent,
            title: 'Agents',
            subtitle: 'AGENTS.md',
            onTap: () => _closeAndPush(context, const CodexAgentsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.dns,
            title: 'MCP',
            subtitle: 'Servers and config',
            onTap: () => _closeAndPush(context, const CodexMcpScreen()),
          ),
          _tile(
            context,
            theme,
            icon: AppIcons.extension_,
            title: 'Apps',
            subtitle: 'Connectors & integrations',
            onTap: () {
              Navigator.pop(context);
              CxAppsSheet.show(context);
            },
          ),
        ] else if (backend == AgentType.pi) ...[
          _sectionLabel(theme, 'Power features'),
          _tile(
            context,
            theme,
            icon: AppIcons.autoFix,
            title: 'Skills',
            subtitle: 'Commands, prompts, extensions',
            onTap: () => _closeAndPush(
              context,
              const SkillsScreen(backend: AgentType.pi),
            ),
          ),
        ] else if (backend == AgentType.piDurable) ...[
          _sectionLabel(theme, 'Power features'),
          _tile(
            context,
            theme,
            icon: AppIcons.autoFix,
            title: 'Skills',
            subtitle: 'Project + user SKILL.md files',
            onTap: () => _closeAndPush(
              context,
              const SkillsScreen(backend: AgentType.piDurable),
            ),
          ),
        ],
        const SizedBox(height: 18),
      ],
    );
  }
}
