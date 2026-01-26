import 'package:flutter/material.dart';

import '../models/agent_type.dart';
import '../models/project.dart';
import '../screens/claude_code_commands_screen.dart';
import '../screens/claude_code_mcp_screen.dart';
import '../screens/claude_code_settings_screen.dart';
import '../screens/codex_agents_screen.dart';
import '../screens/codex_mcp_screen.dart';
import '../screens/hooks_screen.dart';
import '../screens/mcp_servers_screen.dart';
import '../screens/opencode_agents_screen.dart';
import '../screens/opencode_commands_screen.dart';
import '../screens/opencode_plugins_screen.dart';
import '../screens/projects_screen.dart';
import '../screens/skills_screen.dart';
import '../screens/subagents_screen.dart';
import '../screens/custom_tools_screen.dart';
import '../screens/plugins_screen.dart';
import '../screens/tools_screen.dart';
import '../theme/opencode_theme.dart';
import 'chat/detail_sheet.dart';

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
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: theme.textMuted,
          letterSpacing: 0.5,
        ),
      ),
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
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: effectiveColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
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
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(fontSize: 12, color: theme.textMuted),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: theme.textMuted,
              ),
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
            style: TextStyle(color: theme.textMuted, fontSize: 12),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        // Navigation section
        _sectionLabel(theme, 'Navigation'),
        _tile(
          context,
          theme,
          icon: Icons.folder_open_rounded,
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
            icon: Icons.auto_fix_high_rounded,
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
            icon: Icons.bolt_rounded,
            title: 'Commands',
            subtitle: '.opencode/commands',
            onTap: () => _closeAndPush(context, const OpenCodeCommandsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.smart_toy_outlined,
            title: 'Agents',
            subtitle: '.opencode/agent',
            onTap: () => _closeAndPush(context, const OpenCodeAgentsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.dns_rounded,
            title: 'MCP Servers',
            subtitle: 'Model Context Protocol',
            onTap: () => _closeAndPush(context, const McpServersScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.handyman_rounded,
            title: 'Tools',
            subtitle: 'Enabled tools + formatters',
            onTap: () => _closeAndPush(context, const ToolsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.extension_rounded,
            title: 'Plugins',
            subtitle: '.opencode/plugin',
            onTap: () => _closeAndPush(context, const OpenCodePluginsScreen()),
          ),
        ] else if (backend == AgentType.claudeCode) ...[
          _sectionLabel(theme, 'Power features'),
          _tile(
            context,
            theme,
            icon: Icons.auto_fix_high_rounded,
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
            icon: Icons.bolt_rounded,
            title: 'Commands',
            subtitle: '.claude/commands',
            onTap: () =>
                _closeAndPush(context, const ClaudeCodeCommandsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.link_rounded,
            title: 'Hooks',
            subtitle: 'Project + user hooks',
            onTap: () => _closeAndPush(context, const HooksScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.hub_rounded,
            title: 'MCP',
            subtitle: 'Project + user MCP config',
            onTap: () => _closeAndPush(context, const ClaudeCodeMcpScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.smart_toy_outlined,
            title: 'Subagents',
            subtitle: 'Custom subagent definitions',
            onTap: () => _closeAndPush(context, const SubagentsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.extension_rounded,
            title: 'Custom Tools',
            subtitle: 'HTTP APIs, scripts, and more',
            onTap: () => _closeAndPush(context, const CustomToolsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.extension_off_rounded,
            title: 'Plugins',
            subtitle: 'Commands, skills, hooks, MCP',
            onTap: () => _closeAndPush(context, const PluginsScreen()),
          ),
          _sectionLabel(theme, 'Configuration'),
          _tile(
            context,
            theme,
            icon: Icons.tune_rounded,
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
            icon: Icons.auto_fix_high_rounded,
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
            icon: Icons.smart_toy_outlined,
            title: 'Agents',
            subtitle: 'AGENTS.md',
            onTap: () => _closeAndPush(context, const CodexAgentsScreen()),
          ),
          _tile(
            context,
            theme,
            icon: Icons.dns_rounded,
            title: 'MCP',
            subtitle: 'Servers and config',
            onTap: () => _closeAndPush(context, const CodexMcpScreen()),
          ),
        ],
        const SizedBox(height: 18),
      ],
    );
  }
}
