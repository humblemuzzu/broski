
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
import '../theme/design_tokens.dart';
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
import 'package:broski/theme/app_icons.dart';
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
            // Subscribe banner for unpaid users
            const SliverToBoxAdapter(child: SubscribeBanner()),
            const SliverToBoxAdapter(child: _SectionDivider()),
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxl)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Connection')),
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
            if (connection.connection != null && connection.isConnected) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: Insets.screenH,
                  child: _ActiveConnectionCard(connection: connection),
                ),
              ),
            ] else
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
                          MaterialPageRoute(builder: (_) => const ScanScreen()),
                        );
                      },
                    ),
                  ),
                ),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
            SliverToBoxAdapter(child: SectionHeader(title: 'AI')),
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
                            SizedBox(width: Spacing.sm),
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
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Project')),
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
                                  color: theme.colorScheme.onSurface.withValues(
                                    alpha: 0.6,
                                  ),
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
                        icon: AppIcons.sourceCode,
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
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Personalization')),
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
                                  color: theme.colorScheme.onSurface.withValues(
                                    alpha: 0.2,
                                  ),
                                ),
                              ),
                            ),
                            SizedBox(width: Spacing.sm),
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
                      _Divider(),
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
            // ── Account ─────────────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Account')),
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.md)),
            SliverToBoxAdapter(
              child: Padding(
                padding: Insets.screenH,
                child: _SettingsCard(
                  child: _SettingsTile(
                    title:
                        appAuth.user?.displayName ??
                        appAuth.user?.email ??
                        'Account',
                    subtitle: appAuth.user != null
                        ? 'Subscription, sign out, and more'
                        : 'Sign in to manage your account',
                    icon: AppIcons.person,
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
                        SizedBox(width: Spacing.sm),
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
                      MaterialPageRoute(builder: (_) => const AccountScreen()),
                    ),
                  ),
                ),
              ),
            ),
            // ── App ───────────────────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxxl)),
            SliverToBoxAdapter(child: SectionHeader(title: 'App')),
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
                      _Divider(),
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
            SliverToBoxAdapter(child: SectionHeader(title: 'Support')),
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
                      _Divider(),
                      _SettingsTile(
                        title: 'Contact Support',
                        subtitle: 'broskiappp@gmail.com',
                        icon: AppIcons.help,
                        onTap: () =>
                            launchUrl(Uri.parse('mailto:broskiappp@gmail.com')),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            // ── Legal ────────────────────────────────────────────
            const SliverToBoxAdapter(child: SizedBox(height: Spacing.xxl)),
            SliverToBoxAdapter(child: SectionHeader(title: 'Legal')),
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
                  child: Column(
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
            SliverToBoxAdapter(
              child: Center(
                child: Padding(
                  padding: Insets.bottomSm,
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
      borderRadius: Radii.brLg,
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(
              AppIcons.bolt,
              color: theme.colorScheme.primary,
              size: 22,
            ),
            SizedBox(width: Spacing.md),
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
                      SizedBox(width: Spacing.sm),
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
          _Divider(),
          _SettingsTile(
            title: 'Terminal Sessions',
            subtitle: 'PTY terminal sessions',
            icon: AppIcons.terminal,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TerminalScreen()),
            ),
          ),
          _Divider(),
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
          _Divider(),
          _SettingsTile(
            title: 'Commands',
            subtitle: '.opencode/command/*.md',
            icon: AppIcons.code,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodeCommandsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Agents',
            subtitle: '.opencode/agent/*.md',
            icon: AppIcons.agent,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodeAgentsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Plugins',
            subtitle: '.opencode/plugin hooks',
            icon: AppIcons.extension_,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OpenCodePluginsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'MCP Servers',
            subtitle: 'Model Context Protocol',
            icon: AppIcons.dns,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const McpServersScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Tools',
            subtitle: 'AI tools configuration',
            icon: AppIcons.build,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ToolsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Permission Rules',
            subtitle: 'Default session permissions',
            icon: AppIcons.security,
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
            icon: AppIcons.dataUsage,
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
            icon: AppIcons.terminal,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TerminalScreen()),
            ),
          ),
          _Divider(),
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
          _Divider(),
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
          _Divider(),
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
          _Divider(),
          _SettingsTile(
            title: 'Hooks',
            subtitle: 'hooks.json management',
            icon: AppIcons.bolt,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const HooksScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'MCP',
            subtitle: '.mcp.json configuration',
            icon: AppIcons.dns,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ClaudeCodeMcpScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Subagents',
            subtitle: 'Custom subagent definitions',
            icon: AppIcons.agent,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SubagentsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'Custom Tools',
            subtitle: 'HTTP APIs, scripts, and more',
            icon: AppIcons.extension_,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CustomToolsScreen()),
            ),
          ),
          _Divider(),
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
          _Divider(),
          _SettingsTile(
            title: 'Terminal Sessions',
            subtitle: 'PTY terminal sessions',
            icon: AppIcons.terminal,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TerminalScreen()),
            ),
          ),
          _Divider(),
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
          _Divider(),
          _SettingsTile(
            title: 'Agents',
            subtitle: 'AGENTS.md',
            icon: AppIcons.agent,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CodexAgentsScreen()),
            ),
          ),
          _Divider(),
          _SettingsTile(
            title: 'MCP',
            subtitle: 'Servers and config',
            icon: AppIcons.dns,
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const CodexMcpScreen()),
            ),
          ),
          _Divider(),
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
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title});
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
class _SectionDivider extends StatelessWidget {
  const _SectionDivider();
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: Insets.screenH,
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
        padding: Insets.screenAll,
        decoration: BoxDecoration(
          color: theme.colorScheme.surface.withValues(alpha: 0.5),
          borderRadius: Radii.brXl,
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  padding: Insets.card,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    AppIcons.laptop,
                    color: theme.colorScheme.primary,
                    size: 28,
                  ),
                ),
                SizedBox(width: Spacing.lg),
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
                      SizedBox(height: Spacing.xs),
                      const ConnectionQualityIndicator(),
                    ],
                  ),
                ),
                AnimatedRotation(
                  turns: _isExpanded ? 0.5 : 0,
                  duration: const Duration(milliseconds: 200),
                  child: Icon(
                    AppIcons.chevronDown,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                    size: 24,
                  ),
                ),
              ],
            ),
            if (_isExpanded &&
                isConnected &&
                connection.connection != null) ...[
              SizedBox(height: Spacing.xl),
              // Connection details
              Container(
                padding: Insets.card,
                decoration: BoxDecoration(
                  color: ocTheme.backgroundElement,
                  borderRadius: Radii.brLg,
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _ConnectionStat(
                            label: 'Local IP',
                            value: connection.connection!.localIP ?? 'N/A',
                            icon: AppIcons.wifi,
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
                            icon: AppIcons.settings,
                          ),
                        ),
                      ],
                    ),
                    if (connection.connection!.tailscaleIP != null ||
                        connection.rttMs != null) ...[
                      SizedBox(height: Spacing.lg),
                      Divider(
                        height: 1,
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.1,
                        ),
                      ),
                      SizedBox(height: Spacing.lg),
                      Row(
                        children: [
                          if (connection.connection!.tailscaleIP != null)
                            Expanded(
                              child: _ConnectionStat(
                                label: 'Tailscale IP',
                                value: connection.connection!.tailscaleIP!,
                                icon: AppIcons.vpn,
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
                                icon: AppIcons.speed,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              // Connection actions
              SizedBox(height: Spacing.md),
              Row(
                children: [
                  Expanded(
                    child: _ConnectionActionButton(
                      icon: AppIcons.devices,
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
                      icon: AppIcons.unlink,
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
        padding: Insets.cardV,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: Radii.brMd,
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: color),
            SizedBox(width: Spacing.sm),
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
        SizedBox(height: Spacing.sm),
        Text(
          label,
          style: TextStyle(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
        SizedBox(height: Spacing.xs),
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
            SizedBox(width: Spacing.md),
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
            SizedBox(width: Spacing.md),
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
