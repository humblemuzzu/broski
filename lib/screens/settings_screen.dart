import 'package:broski/models/agent_type.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/onboarding_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/theme_provider.dart';
import 'package:broski/screens/ai_backend_screen.dart';
import 'package:broski/screens/claude_code_commands_screen.dart';
import 'package:broski/screens/claude_code_mcp_screen.dart';
import 'package:broski/screens/claude_code_settings_screen.dart';
import 'package:broski/screens/codex_agents_screen.dart';
import 'package:broski/screens/codex_mcp_screen.dart';
import 'package:broski/screens/custom_tools_screen.dart';
import 'package:broski/screens/customization_screen.dart';
import 'package:broski/screens/hooks_screen.dart';
import 'package:broski/screens/mcp_servers_screen.dart';
import 'package:broski/screens/opencode_agents_screen.dart';
import 'package:broski/screens/opencode_commands_screen.dart';
import 'package:broski/screens/opencode_global_config_screen.dart';
import 'package:broski/screens/opencode_plugins_screen.dart';
import 'package:broski/screens/permission_rules_screen.dart';
import 'package:broski/screens/plugins_screen.dart';
import 'package:broski/screens/scan_screen.dart';
import 'package:broski/screens/settings/app_version_line.dart';
import 'package:broski/screens/sheets/cx_apps_sheet.dart';
import 'package:broski/screens/sheets/git_panel_sheet.dart';
import 'package:broski/screens/skills_screen.dart';
import 'package:broski/screens/subagents_screen.dart';
import 'package:broski/screens/subscription_usage_screen.dart';
import 'package:broski/screens/terminal_screen.dart';
import 'package:broski/screens/tools_screen.dart';
import 'package:broski/screens/voice_settings_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/link/machines_connection_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});
  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _powerFeaturesExpanded = false;
  @override
  Widget build(BuildContext context) {
    final linkMachine = ref.watch(
      machinesProvider.select((machines) => machines.selectedId != null),
    );
    final currentThemeInfo = ref.watch(currentThemeInfoProvider);
    final currentAgent = ref.watch(agentTypeProvider);
    final selection = ref.watch(selectionProvider);
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: AdaptiveContainer(
          width: ContentWidth.standard,
          child: CustomScrollView(
            slivers: [
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                  child: Text(
                    'Settings',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 32,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              const SliverToBoxAdapter(
                child: _SectionHeader(title: 'Connection'),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
              if (!linkMachine)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: Insets.screenH,
                    child: _SettingsCard(
                      child: _SettingsTile(
                        title: 'No Connection',
                        subtitle: 'Connect to a Mac to use Broski',
                        icon: AppIcons.unlink,
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const ScanScreen(),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                ),
              const SliverToBoxAdapter(child: MachinesConnectionCard()),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
              const SliverToBoxAdapter(child: _SectionHeader(title: 'AI')),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: Insets.screenH,
                  child: _SettingsCard(
                    child: Column(
                      children: [
                        _SettingsTile(
                          title: 'AI Backend',
                          subtitle: currentAgent.displayName,
                          icon: AppIcons.agent,
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: theme.colorScheme.primary.withValues(
                                    alpha: 0.15,
                                  ),
                                  borderRadius: Radii.brSm,
                                ),
                                child: Text(
                                  switch (currentAgent) {
                                    AgentType.opencode => 'OC',
                                    AgentType.claudeCode => 'CC',
                                    AgentType.codex => 'CX',
                                  },
                                  style: TextStyle(
                                    color: theme.colorScheme.primary,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              const SizedBox(width: Spacing.sm),
                              Icon(
                                AppIcons.chevronRight,
                                size: 20,
                                color: theme.colorScheme.onSurface.withValues(
                                  alpha: 0.5,
                                ),
                              ),
                            ],
                          ),
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const AIBackendScreen(),
                            ),
                          ),
                        ),
                        const _Divider(),
                        _PowerFeaturesTile(
                          currentAgent: currentAgent,
                          isExpanded: _powerFeaturesExpanded,
                          onToggle: () => setState(
                            () => _powerFeaturesExpanded =
                                !_powerFeaturesExpanded,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: AnimatedCrossFade(
                  firstChild: const SizedBox.shrink(),
                  secondChild: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _PowerFeaturesExpandedCard(
                      currentAgent: currentAgent,
                    ),
                  ),
                  crossFadeState: _powerFeaturesExpanded
                      ? CrossFadeState.showSecond
                      : CrossFadeState.showFirst,
                  duration: const Duration(milliseconds: 200),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
              const SliverToBoxAdapter(child: _SectionHeader(title: 'Project')),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: Insets.screenH,
                  child: _SettingsCard(
                    child: Column(
                      children: [
                        _SettingsTile(
                          title: 'Current project',
                          subtitle: selection.project == null
                              ? 'Pick a project for project-scoped power features'
                              : '${selection.project!.name} • ${selection.project!.path}',
                          icon: AppIcons.folder,
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (selection.project != null)
                                IconButton(
                                  tooltip: 'Clear project',
                                  onPressed: () => ref
                                      .read(selectionProvider.notifier)
                                      .clearProject(),
                                  icon: Icon(
                                    AppIcons.close,
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.6),
                                  ),
                                ),
                              Icon(
                                AppIcons.chevronRight,
                                size: 20,
                                color: theme.colorScheme.onSurface.withValues(
                                  alpha: 0.5,
                                ),
                              ),
                            ],
                          ),
                          onTap: () async {
                            final picked =
                                await DetailSheet.show<ProjectSummary>(
                                  context: context,
                                  title: 'Select Project',
                                  initialSize: 0.5,
                                  child: _ProjectPickerContent(
                                    onSelect: (p) => Navigator.pop(context, p),
                                  ),
                                );
                            if (picked == null) return;
                            ref
                                .read(selectionProvider.notifier)
                                .selectProject(picked);
                          },
                        ),
                        const _Divider(),
                        _SettingsTile(
                          title: 'Git & GitHub',
                          subtitle: selection.project == null
                              ? 'Select a project first'
                              : 'Status, commits, branches, PRs, issues',
                          icon: AppIcons.sourceCode,
                          onTap: () async {
                            final selected = selection.project;
                            if (selected == null) {
                              showInfo(context, 'Select a project first');
                              return;
                            }
                            await GitPanelSheet.show(
                              context: context,
                              projectPath: selected.path,
                              projectName: selected.name,
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
              const SliverToBoxAdapter(
                child: _SectionHeader(title: 'Personalization'),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: Insets.screenH,
                  child: _SettingsCard(
                    child: Column(
                      children: [
                        _SettingsTile(
                          title: 'Customization',
                          subtitle: 'Theme, input bar, navigation',
                          icon: AppIcons.palette,
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 14,
                                height: 14,
                                decoration: BoxDecoration(
                                  color:
                                      currentThemeInfo?.primaryColor ??
                                      theme.colorScheme.primary,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.2),
                                  ),
                                ),
                              ),
                              const SizedBox(width: Spacing.sm),
                              Icon(
                                AppIcons.chevronRight,
                                size: 20,
                                color: theme.colorScheme.onSurface.withValues(
                                  alpha: 0.5,
                                ),
                              ),
                            ],
                          ),
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const CustomizationScreen(),
                            ),
                          ),
                        ),
                        const _Divider(),
                        _SettingsTile(
                          title: 'Voice Input',
                          subtitle: 'Speech-to-text settings',
                          icon: AppIcons.mic,
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const VoiceSettingsScreen(),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              // ── App ───────────────────────────────────────────────
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
              const SliverToBoxAdapter(child: _SectionHeader(title: 'App')),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: Insets.screenH,
                  child: _SettingsCard(
                    child: Column(
                      children: [
                        _SettingsTile(
                          title: 'Clear Cache',
                          subtitle: 'Delete cached sessions & offline data',
                          icon: AppIcons.delete,
                          onTap: () => _showClearCacheDialog(context, ref),
                        ),
                        const _Divider(),
                        _SettingsTile(
                          title: 'Replay Onboarding',
                          subtitle: 'Re-run the first-launch setup',
                          icon: AppIcons.replay,
                          onTap: () => _replayOnboarding(context, ref),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              // ── Support ──────────────────────────────────────────
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
              const SliverToBoxAdapter(child: _SectionHeader(title: 'Support')),
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: Insets.screenH,
                  child: _SettingsCard(
                    child: Column(
                      children: [
                        _SettingsTile(
                          title: 'Setup Guide',
                          subtitle: 'How to connect your Mac',
                          icon: AppIcons.menuBook,
                          onTap: () => launchUrl(
                            Uri.parse('https://broskiapp.com/docs/setup'),
                            mode: LaunchMode.externalApplication,
                          ),
                        ),
                        const _Divider(),
                        _SettingsTile(
                          title: 'Contact Support',
                          subtitle: 'broskiappp@gmail.com',
                          icon: AppIcons.help,
                          onTap: () => launchUrl(
                            Uri.parse('mailto:broskiappp@gmail.com'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              // ── Legal ────────────────────────────────────────────
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxl)),
              const SliverToBoxAdapter(child: _SectionHeader(title: 'Legal')),
              const SliverToBoxAdapter(child: SizedBox(height: 10)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: Insets.screenH,
                  child: _SettingsCard(
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface.withValues(alpha: 0.2),
                      borderRadius: Radii.brLg,
                      border: Border.all(
                        color: ocTheme.borderSubtle.withValues(alpha: 0.3),
                      ),
                    ),
                    child: const Column(
                      children: [
                        _LinkTile(
                          title: 'Privacy Policy',
                          icon: AppIcons.privacy,
                          url: 'https://broskiapp.com/legal/privacy',
                        ),
                        _Divider(),
                        _LinkTile(
                          title: 'Terms of Service',
                          icon: AppIcons.description,
                          url: 'https://broskiapp.com/legal/terms',
                        ),
                        _Divider(),
                        _LinkTile(
                          title: 'EULA',
                          icon: AppIcons.gavel,
                          url:
                              'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              // ── Version (bottom) ─────────────────────────────────
              const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
              const SliverToBoxAdapter(child: AppVersionLine()),
              const SliverToBoxAdapter(child: SizedBox(height: 40)),
            ],
          ),
        ),
      ),
    );
  }

  void _replayOnboarding(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Replay Onboarding?'),
        content: const Text(
          'This will reset the onboarding flow and show you the first-launch experience. You\'ll need to go through the setup flow again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              ref.read(onboardingProvider.notifier).resetOnboarding();
              ref.read(connectionProvider.notifier).clearConnection();
            },
            child: const Text('Replay'),
          ),
        ],
      ),
    );
  }

  void _showClearCacheDialog(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear Cache?'),
        content: const Text(
          'This will delete all cached sessions, messages, and offline data. Your connection settings will be preserved.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () async {
              Navigator.pop(context);
              final storage = ref.read(storageServiceProvider);
              await storage.clearCache();
              if (context.mounted) {
                showInfo(context, 'Cache cleared successfully');
              }
            },
            child: const Text('Clear'),
          ),
        ],
      ),
    );
  }
}

class _PowerFeaturesTile extends StatelessWidget {
  const _PowerFeaturesTile({
    required this.currentAgent,
    required this.isExpanded,
    required this.onToggle,
  });
  final AgentType currentAgent;
  final bool isExpanded;
  final VoidCallback onToggle;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final featureCount = _getFeatureCount(currentAgent);
    return InkWell(
      onTap: onToggle,
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(AppIcons.bolt, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        'Power Features',
                        style: TextStyle(
                          color: theme.colorScheme.onSurface,
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: Spacing.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primary.withValues(
                            alpha: 0.15,
                          ),
                          borderRadius: Radii.brSm,
                        ),
                        child: Text(
                          '$featureCount',
                          style: TextStyle(
                            color: theme.colorScheme.primary,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'Advanced ${currentAgent.displayName} configuration',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            AnimatedRotation(
              turns: isExpanded ? 0.5 : 0,
              duration: const Duration(milliseconds: 200),
              child: Icon(
                AppIcons.chevronDown,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                size: 24,
              ),
            ),
          ],
        ),
      ),
    );
  }

  int _getFeatureCount(AgentType agent) {
    switch (agent) {
      case AgentType.opencode:
        return 9;
      case AgentType.claudeCode:
        return 9;
      case AgentType.codex:
        return 4;
    }
  }
}

class _PowerFeaturesExpandedCard extends StatelessWidget {
  const _PowerFeaturesExpandedCard({required this.currentAgent});
  final AgentType currentAgent;
  List<Widget> _getPowerFeatures(BuildContext context, AgentType agent) {
    switch (agent) {
      case AgentType.opencode:
        return [
          _SettingsTile(
            title: 'AI Usage',
            subtitle: 'Your AI provider limits & credits',
            icon: AppIcons.dataUsage,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SubscriptionUsageScreen(),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Terminal Sessions',
            subtitle: 'PTY terminal sessions',
            icon: AppIcons.terminal,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TerminalScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Skills',
            subtitle: 'SKILL.md management',
            icon: AppIcons.autoFix,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SkillsScreen(backend: AgentType.opencode),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Commands',
            subtitle: '.opencode/command/*.md',
            icon: AppIcons.code,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodeCommandsScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Agents',
            subtitle: '.opencode/agent/*.md',
            icon: AppIcons.agent,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodeAgentsScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Plugins',
            subtitle: '.opencode/plugin hooks',
            icon: AppIcons.extension_,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodePluginsScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'MCP Servers',
            subtitle: 'Model Context Protocol',
            icon: AppIcons.dns,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const McpServersScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Tools',
            subtitle: 'AI tools configuration',
            icon: AppIcons.build,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ToolsScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Permission Rules',
            subtitle: 'Default session permissions',
            icon: AppIcons.security,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const PermissionRulesScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Global Configuration',
            subtitle: 'Settings across all projects',
            icon: AppIcons.tune,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const OpenCodeGlobalConfigScreen(),
              ),
            ),
          ),
        ];
      case AgentType.claudeCode:
        return [
          _SettingsTile(
            title: 'AI Usage',
            subtitle: 'Your AI provider limits & credits',
            icon: AppIcons.dataUsage,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SubscriptionUsageScreen(),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Terminal Sessions',
            subtitle: 'PTY terminal sessions',
            icon: AppIcons.terminal,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TerminalScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Settings',
            subtitle: 'Language, gitignore, channel',
            icon: AppIcons.tune,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const ClaudeCodeSettingsScreen(),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Skills',
            subtitle: 'SKILL.md management',
            icon: AppIcons.autoFix,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) =>
                    const SkillsScreen(backend: AgentType.claudeCode),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Commands',
            subtitle: '.claude/commands/*.md',
            icon: AppIcons.code,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const ClaudeCodeCommandsScreen(),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Hooks',
            subtitle: 'hooks.json management',
            icon: AppIcons.bolt,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const HooksScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'MCP',
            subtitle: '.mcp.json configuration',
            icon: AppIcons.dns,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ClaudeCodeMcpScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Subagents',
            subtitle: 'Custom subagent definitions',
            icon: AppIcons.agent,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SubagentsScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Custom Tools',
            subtitle: 'HTTP APIs, scripts, and more',
            icon: AppIcons.extension_,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CustomToolsScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Plugins',
            subtitle: 'Commands, skills, hooks, MCP',
            icon: AppIcons.extensionOff,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const PluginsScreen()),
            ),
          ),
        ];
      case AgentType.codex:
        return [
          _SettingsTile(
            title: 'AI Usage',
            subtitle: 'Your AI provider limits & credits',
            icon: AppIcons.dataUsage,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SubscriptionUsageScreen(),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Terminal Sessions',
            subtitle: 'PTY terminal sessions',
            icon: AppIcons.terminal,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TerminalScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Skills',
            subtitle: 'SKILL.md management',
            icon: AppIcons.autoFix,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SkillsScreen(backend: AgentType.codex),
              ),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Agents',
            subtitle: 'AGENTS.md',
            icon: AppIcons.agent,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CodexAgentsScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'MCP',
            subtitle: 'Servers and config',
            icon: AppIcons.dns,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CodexMcpScreen()),
            ),
          ),
          const _Divider(),
          _SettingsTile(
            title: 'Apps',
            subtitle: 'Connectors & integrations',
            icon: AppIcons.extension_,
            onTap: () => CxAppsSheet.show(context),
          ),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final features = _getPowerFeatures(context, currentAgent);
    return Padding(
      padding: Insets.screenH,
      child: Container(
        decoration: BoxDecoration(
          color: theme.colorScheme.surface.withValues(alpha: 0.4),
          borderRadius: Radii.brLg,
          border: Border.all(
            color: ocTheme.borderSubtle.withValues(alpha: 0.7),
          ),
        ),
        child: Column(children: features),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: Insets.screenH,
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _ProjectPickerContent extends ConsumerStatefulWidget {
  const _ProjectPickerContent({required this.onSelect});
  final void Function(ProjectSummary) onSelect;
  @override
  ConsumerState<_ProjectPickerContent> createState() =>
      _ProjectPickerContentState();
}

class _ProjectPickerContentState extends ConsumerState<_ProjectPickerContent> {
  final TextEditingController _search = TextEditingController();
  List<ProjectSummary> _projects = const [];
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _search.addListener(() {
      if (mounted) setState(() {});
    });
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final connection = ref.read(connectionProvider);
    final storage = ref.read(storageServiceProvider);
    try {
      List<ProjectSummary> projects;
      if (connection.isOfflineMode) {
        projects = await storage.getCachedProjects();
      } else {
        final bridge = ref.read(bridgeServiceProvider);
        projects = await bridge.listProjects();
        if (projects.isNotEmpty) {
          await storage.cacheProjects(projects);
        }
      }
      projects.sort((a, b) {
        final aLast = a.lastOpened ?? 0;
        final bLast = b.lastOpened ?? 0;
        final c = bLast.compareTo(aLast);
        if (c != 0) return c;
        return a.name.compareTo(b.name);
      });
      if (!mounted) return;
      setState(() {
        _projects = projects;
        _loading = false;
        if (projects.isEmpty) {
          _error = connection.isOfflineMode
              ? 'No cached projects available offline'
              : 'No projects found';
        }
      });
    } catch (e) {
      final cached = await storage.getCachedProjects();
      if (!mounted) return;
      if (cached.isNotEmpty) {
        setState(() {
          _projects = cached;
          _loading = false;
        });
      } else {
        setState(() {
          _error = humanizeError(e);
          _loading = false;
        });
      }
    }
  }

  List<ProjectSummary> get _filtered {
    final q = _search.text.trim().toLowerCase();
    if (q.isEmpty) return _projects;
    return _projects
        .where(
          (p) =>
              p.name.toLowerCase().contains(q) ||
              p.path.toLowerCase().contains(q),
        )
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = _filtered;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: TextField(
            controller: _search,
            decoration: const InputDecoration(
              hintText: 'Search projects',
              prefixIcon: Icon(AppIcons.search),
            ),
          ),
        ),
        if (_loading)
          const Padding(
            padding: Insets.xxxl,
            child: CircularProgressIndicator(),
          )
        else if (_error != null)
          Padding(
            padding: Insets.card,
            child: Text(
              _error!,
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          )
        else
          ...items.map(
            (p) => ListTile(
              leading: const Icon(AppIcons.folder),
              title: Text(
                p.name.isEmpty ? p.path : p.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                p.path,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              onTap: () => widget.onSelect(p),
            ),
          ),
      ],
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.child, this.decoration});
  final Widget child;
  final BoxDecoration? decoration;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);
    return Container(
      decoration:
          decoration ??
          BoxDecoration(
            color: themeData.colorScheme.surface.withValues(alpha: 0.5),
            borderRadius: Radii.brLg,
            border: Border.all(color: ocTheme.borderSubtle),
          ),
      child: child,
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
    this.trailing,
  });
  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            trailing ??
                Icon(
                  AppIcons.chevronRight,
                  size: 20,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                ),
          ],
        ),
      ),
    );
  }
}

class _LinkTile extends StatelessWidget {
  const _LinkTile({required this.title, required this.icon, required this.url});
  final String title;
  final IconData icon;
  final String url;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: () =>
          launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(
              icon,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              size: 22,
            ),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  color: theme.colorScheme.onSurface,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Icon(
              AppIcons.openExternal,
              size: 18,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
            ),
          ],
        ),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      thickness: 1,
      indent: 16,
      endIndent: 16,
      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.08),
    );
  }
}
