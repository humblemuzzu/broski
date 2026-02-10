import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/agent_type.dart';
import '../models/project.dart';
import '../providers/agent_type_provider.dart';
import '../providers/app_info_provider.dart';
import '../providers/app_auth_provider.dart';
import '../widgets/upgrade_overlay.dart';
import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/theme_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/connection_quality_indicator.dart';
import 'account_screen.dart';
import 'ai_backend_screen.dart';
import 'customization_screen.dart';
import 'device_manager_screen.dart';
import 'mcp_servers_screen.dart';

import 'sheets/cx_apps_sheet.dart';
import 'sheets/git_panel_sheet.dart';
import 'subscription_usage_screen.dart';
import 'subagents_screen.dart';
import 'terminal_screen.dart';
import 'tools_screen.dart';
import 'custom_tools_screen.dart';
import 'plugins_screen.dart';
import 'skills_screen.dart';
import 'hooks_screen.dart';
import 'opencode_plugins_screen.dart';
import 'claude_code_mcp_screen.dart';
import 'codex_mcp_screen.dart';
import 'claude_code_commands_screen.dart';
import 'claude_code_settings_screen.dart';
import 'opencode_agents_screen.dart';
import 'opencode_commands_screen.dart';
import 'permission_rules_screen.dart';
import 'codex_agents_screen.dart';
import 'scan_screen.dart';
import 'voice_settings_screen.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _powerFeaturesExpanded = false;

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final appAuth = ref.watch(appAuthProvider);
    final currentThemeInfo = ref.watch(currentThemeInfoProvider);
    final currentAgent = ref.watch(agentTypeProvider);
    final appVersion = ref.watch(appVersionProvider);
    final selection = ref.watch(selectionProvider);
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
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

            // Subscribe banner for unpaid users
            const SliverToBoxAdapter(child: SubscribeBanner()),

            const SliverToBoxAdapter(child: _SectionDivider()),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),

            SliverToBoxAdapter(child: SectionHeader(title: 'Connection')),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),

            if (connection.connection != null && connection.isConnected) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _ActiveConnectionCard(connection: connection),
                ),
              ),
            ] else
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _SettingsCard(
                    child: _SettingsTile(
                      title: 'No Connection',
                      subtitle: 'Connect to a Mac to use Broski',
                      icon: Icons.link_off_rounded,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const ScanScreen()),
                        );
                      },
                    ),
                  ),
                ),
              ),

            const SliverToBoxAdapter(child: SizedBox(height: 32)),
            SliverToBoxAdapter(child: SectionHeader(title: 'AI')),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'AI Backend',
                        subtitle: currentAgent.displayName,
                        icon: Icons.smart_toy_rounded,
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
                                borderRadius: BorderRadius.circular(6),
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
                            const SizedBox(width: 8),
                            Icon(
                              Icons.chevron_right_rounded,
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
                      _Divider(),
                      _PowerFeaturesTile(
                        currentAgent: currentAgent,
                        isExpanded: _powerFeaturesExpanded,
                        onToggle: () => setState(
                          () =>
                              _powerFeaturesExpanded = !_powerFeaturesExpanded,
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
                  child: _PowerFeaturesExpandedCard(currentAgent: currentAgent),
                ),
                crossFadeState: _powerFeaturesExpanded
                    ? CrossFadeState.showSecond
                    : CrossFadeState.showFirst,
                duration: const Duration(milliseconds: 200),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 32)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Project')),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Current project',
                        subtitle: selection.project == null
                            ? 'Pick a project for project-scoped power features'
                            : '${selection.project!.name} • ${selection.project!.path}',
                        icon: Icons.folder_rounded,
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
                                  Icons.close_rounded,
                                  color: theme.colorScheme.onSurface.withValues(
                                    alpha: 0.6,
                                  ),
                                ),
                              ),
                            Icon(
                              Icons.chevron_right_rounded,
                              size: 20,
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: 0.5,
                              ),
                            ),
                          ],
                        ),
                        onTap: () async {
                          final picked = await DetailSheet.show<ProjectSummary>(
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
                      _Divider(),
                      _SettingsTile(
                        title: 'Git & GitHub',
                        subtitle: selection.project == null
                            ? 'Select a project first'
                            : 'Status, commits, branches, PRs, issues',
                        icon: Icons.source_rounded,
                        onTap: () async {
                          final selected = selection.project;
                          if (selected == null) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Select a project first'),
                              ),
                            );
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

            const SliverToBoxAdapter(child: SizedBox(height: 32)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Personalization')),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Customization',
                        subtitle: 'Theme, input bar, navigation',
                        icon: Icons.palette_rounded,
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
                                  color: theme.colorScheme.onSurface.withValues(
                                    alpha: 0.2,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Icon(
                              Icons.chevron_right_rounded,
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
                      _Divider(),
                      _SettingsTile(
                        title: 'Voice Input',
                        subtitle: 'Speech-to-text settings',
                        icon: Icons.mic_rounded,
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

            // ── Account ─────────────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Account')),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: _SettingsTile(
                    title:
                        appAuth.user?.displayName ??
                        appAuth.user?.email ??
                        'Account',
                    subtitle: appAuth.user != null
                        ? 'Subscription, sign out, and more'
                        : 'Sign in to manage your account',
                    icon: Icons.person_rounded,
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (appAuth.user != null)
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: theme.colorScheme.primary,
                              shape: BoxShape.circle,
                            ),
                          ),
                        const SizedBox(width: 8),
                        Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.5,
                          ),
                        ),
                      ],
                    ),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const AccountScreen()),
                    ),
                  ),
                ),
              ),
            ),

            // ── App ───────────────────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
            SliverToBoxAdapter(child: SectionHeader(title: 'App')),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Clear Cache',
                        subtitle: 'Delete cached sessions & offline data',
                        icon: Icons.delete_outline_rounded,
                        onTap: () => _showClearCacheDialog(context, ref),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Replay Onboarding',
                        subtitle: 'Re-run the first-launch setup',
                        icon: Icons.replay_rounded,
                        onTap: () => _replayOnboarding(context, ref),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // ── Support ──────────────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Support')),
            const SliverToBoxAdapter(child: SizedBox(height: 12)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Setup Guide',
                        subtitle: 'How to connect your Mac',
                        icon: Icons.menu_book_rounded,
                        onTap: () => launchUrl(
                          Uri.parse('https://broskiapp.com/docs/setup'),
                          mode: LaunchMode.externalApplication,
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Contact Support',
                        subtitle: 'broskiappp@gmail.com',
                        icon: Icons.help_outline_rounded,
                        onTap: () =>
                            launchUrl(Uri.parse('mailto:broskiappp@gmail.com')),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // ── Legal ────────────────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Legal')),
            const SliverToBoxAdapter(child: SizedBox(height: 10)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: ocTheme.borderSubtle.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Column(
                    children: [
                      _LinkTile(
                        title: 'Privacy Policy',
                        icon: Icons.privacy_tip_outlined,
                        url: 'https://broskiapp.com/legal/privacy',
                      ),
                      _Divider(),
                      _LinkTile(
                        title: 'Terms of Service',
                        icon: Icons.description_outlined,
                        url: 'https://broskiapp.com/legal/terms',
                      ),
                      _Divider(),
                      _LinkTile(
                        title: 'EULA',
                        icon: Icons.gavel_rounded,
                        url:
                            'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // ── Version (bottom) ─────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
            SliverToBoxAdapter(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    'Broski v$appVersion',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(
                        alpha: 0.25,
                      ),
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 40)),
          ],
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
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Cache cleared successfully')),
                );
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
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              Icons.bolt_rounded,
              color: theme.colorScheme.primary,
              size: 22,
            ),
            const SizedBox(width: 12),
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
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primary.withValues(
                            alpha: 0.15,
                          ),
                          borderRadius: BorderRadius.circular(6),
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
                Icons.keyboard_arrow_down_rounded,
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
            icon: Icons.data_usage_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SubscriptionUsageScreen(),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Terminal Sessions',
            subtitle: 'PTY terminal sessions',
            icon: Icons.terminal_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TerminalScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Skills',
            subtitle: 'SKILL.md management',
            icon: Icons.auto_fix_high_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SkillsScreen(backend: AgentType.opencode),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Commands',
            subtitle: '.opencode/command/*.md',
            icon: Icons.code_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodeCommandsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Agents',
            subtitle: '.opencode/agent/*.md',
            icon: Icons.smart_toy_outlined,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodeAgentsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Plugins',
            subtitle: '.opencode/plugin hooks',
            icon: Icons.extension_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodePluginsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'MCP Servers',
            subtitle: 'Model Context Protocol',
            icon: Icons.dns_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const McpServersScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Tools',
            subtitle: 'AI tools configuration',
            icon: Icons.build_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ToolsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Permission Rules',
            subtitle: 'Default session permissions',
            icon: Icons.security_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const PermissionRulesScreen()),
            ),
          ),
        ];

      case AgentType.claudeCode:
        return [
          _SettingsTile(
            title: 'AI Usage',
            subtitle: 'Your AI provider limits & credits',
            icon: Icons.data_usage_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SubscriptionUsageScreen(),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Settings',
            subtitle: 'Language, gitignore, channel',
            icon: Icons.tune_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const ClaudeCodeSettingsScreen(),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Skills',
            subtitle: 'SKILL.md management',
            icon: Icons.auto_fix_high_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) =>
                    const SkillsScreen(backend: AgentType.claudeCode),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Commands',
            subtitle: '.claude/commands/*.md',
            icon: Icons.code_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const ClaudeCodeCommandsScreen(),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Hooks',
            subtitle: 'hooks.json management',
            icon: Icons.bolt_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const HooksScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'MCP',
            subtitle: '.mcp.json configuration',
            icon: Icons.dns_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ClaudeCodeMcpScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Subagents',
            subtitle: 'Custom subagent definitions',
            icon: Icons.smart_toy_outlined,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SubagentsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Custom Tools',
            subtitle: 'HTTP APIs, scripts, and more',
            icon: Icons.extension_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CustomToolsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Plugins',
            subtitle: 'Commands, skills, hooks, MCP',
            icon: Icons.extension_off_rounded,
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
            icon: Icons.data_usage_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SubscriptionUsageScreen(),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Skills',
            subtitle: 'SKILL.md management',
            icon: Icons.auto_fix_high_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const SkillsScreen(backend: AgentType.codex),
              ),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Agents',
            subtitle: 'AGENTS.md',
            icon: Icons.smart_toy_outlined,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CodexAgentsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'MCP',
            subtitle: 'Servers and config',
            icon: Icons.dns_rounded,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CodexMcpScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Apps',
            subtitle: 'Connectors & integrations',
            icon: Icons.extension_rounded,
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
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Container(
        decoration: BoxDecoration(
          color: theme.colorScheme.surface.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: ocTheme.borderSubtle.withValues(alpha: 0.7),
          ),
        ),
        child: Column(children: features),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
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

class _SectionDivider extends StatelessWidget {
  const _SectionDivider();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      height: 1,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.colorScheme.onSurface.withValues(alpha: 0),
            theme.colorScheme.onSurface.withValues(alpha: 0.1),
            theme.colorScheme.onSurface.withValues(alpha: 0),
          ],
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
          _error = e.toString();
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
              prefixIcon: Icon(Icons.search_rounded),
            ),
          ),
        ),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(32),
            child: CircularProgressIndicator(),
          )
        else if (_error != null)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              _error!,
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          )
        else
          ...items.map(
            (p) => ListTile(
              leading: const Icon(Icons.folder_outlined),
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

class _ActiveConnectionCard extends ConsumerStatefulWidget {
  const _ActiveConnectionCard({required this.connection});

  final BridgeConnectionState connection;

  @override
  ConsumerState<_ActiveConnectionCard> createState() =>
      _ActiveConnectionCardState();
}

class _ActiveConnectionCardState extends ConsumerState<_ActiveConnectionCard> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final connection = widget.connection;
    final isConnected = connection.isConnected;

    return GestureDetector(
      onTap: () => setState(() => _isExpanded = !_isExpanded),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.laptop_mac_rounded,
                    color: theme.colorScheme.primary,
                    size: 28,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'OpenCode Bridge',
                        style: TextStyle(
                          color: theme.colorScheme.onSurface,
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const ConnectionQualityIndicator(),
                    ],
                  ),
                ),
                AnimatedRotation(
                  turns: _isExpanded ? 0.5 : 0,
                  duration: const Duration(milliseconds: 200),
                  child: Icon(
                    Icons.keyboard_arrow_down_rounded,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                    size: 24,
                  ),
                ),
              ],
            ),
            if (_isExpanded &&
                isConnected &&
                connection.connection != null) ...[
              const SizedBox(height: 20),
              // Connection details
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: ocTheme.backgroundElement,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _ConnectionStat(
                            label: 'Local IP',
                            value: connection.connection!.localIP ?? 'N/A',
                            icon: Icons.wifi_rounded,
                          ),
                        ),
                        Container(
                          width: 1,
                          height: 40,
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.1,
                          ),
                        ),
                        Expanded(
                          child: _ConnectionStat(
                            label: 'Port',
                            value: '${connection.connection!.port}',
                            icon: Icons.settings_ethernet_rounded,
                          ),
                        ),
                      ],
                    ),
                    if (connection.connection!.tailscaleIP != null ||
                        connection.rttMs != null) ...[
                      const SizedBox(height: 16),
                      Divider(
                        height: 1,
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.1,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          if (connection.connection!.tailscaleIP != null)
                            Expanded(
                              child: _ConnectionStat(
                                label: 'Tailscale IP',
                                value: connection.connection!.tailscaleIP!,
                                icon: Icons.vpn_lock_rounded,
                              ),
                            ),
                          if (connection.connection!.tailscaleIP != null &&
                              connection.rttMs != null)
                            Container(
                              width: 1,
                              height: 40,
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: 0.1,
                              ),
                            ),
                          if (connection.rttMs != null)
                            Expanded(
                              child: _ConnectionStat(
                                label: 'Latency',
                                value: '${connection.rttMs}ms',
                                icon: Icons.speed_rounded,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              // Connection actions
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _ConnectionActionButton(
                      icon: Icons.devices_rounded,
                      label: 'Device Manager',
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => const DeviceManagerScreen(),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _ConnectionActionButton(
                      icon: Icons.link_off_rounded,
                      label: 'Disconnect',
                      isDestructive: true,
                      onTap: () =>
                          ref.read(connectionProvider.notifier).disconnect(),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Compact action button for connection card expanded section
class _ConnectionActionButton extends StatelessWidget {
  const _ConnectionActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.isDestructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool isDestructive;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = isDestructive
        ? theme.colorScheme.error
        : theme.colorScheme.primary;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConnectionStat extends StatelessWidget {
  const _ConnectionStat({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      children: [
        Icon(icon, color: theme.colorScheme.primary, size: 18),
        const SizedBox(height: 8),
        Text(
          label,
          style: TextStyle(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            color: theme.colorScheme.onSurface,
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
          overflow: TextOverflow.ellipsis,
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
            borderRadius: BorderRadius.circular(16),
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
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary, size: 22),
            const SizedBox(width: 12),
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
                  Icons.chevron_right_rounded,
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
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              icon,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              size: 22,
            ),
            const SizedBox(width: 12),
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
              Icons.open_in_new_rounded,
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
