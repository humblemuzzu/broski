import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/agent_type.dart';
import '../models/project.dart';
import '../providers/agent_type_provider.dart';
import '../providers/app_info_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/theme_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/connection_quality_indicator.dart';
import 'ai_backend_screen.dart';
import 'customization_screen.dart';
import 'device_manager_screen.dart';
import 'mcp_servers_screen.dart';
import 'providers_screen.dart';
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
import 'voice_settings_screen.dart';
// TODO(artifacts): Re-enable when feature is ready
// import 'artifacts_screen.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  // Track expanded state for backend sections (collapsed by default)
  bool _openCodeExpanded = false;
  bool _claudeCodeExpanded = false;
  bool _codexExpanded = false;

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final currentThemeInfo = ref.watch(currentThemeInfoProvider);
    final currentAgent = ref.watch(agentTypeProvider);
    final appVersion = ref.watch(appVersionProvider);
    final selection = ref.watch(selectionProvider);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            // Header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
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

            // CONNECTION Section
            if (connection.connection != null && connection.isConnected) ...[
              SliverToBoxAdapter(child: _SectionHeader(title: 'Connection')),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _ActiveConnectionCard(connection: connection),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 12)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _SettingsCard(
                    child: Column(
                      children: [
                        _SettingsTile(
                          title: 'Device Manager',
                          subtitle: 'Paired Macs and connections',
                          icon: Icons.devices_rounded,
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const DeviceManagerScreen(),
                            ),
                          ),
                        ),
                        _Divider(),
                        _ActionTile(
                          title: 'Disconnect',
                          subtitle: 'End current session',
                          icon: Icons.link_off_rounded,
                          iconColor: theme.colorScheme.error,
                          onTap: () => ref
                              .read(connectionProvider.notifier)
                              .disconnect(),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 28)),
            ],

            // PROJECT CONTEXT Section
            SliverToBoxAdapter(child: _SectionHeader(title: 'Project Context')),
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
                          final picked =
                              await showModalBottomSheet<ProjectSummary>(
                                context: context,
                                isScrollControlled: true,
                                backgroundColor: Colors.transparent,
                                builder: (_) => const _ProjectPickerSheet(),
                              );
                          if (picked == null) return;
                          ref
                              .read(selectionProvider.notifier)
                              .selectProject(picked);
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 28)),

            // APPEARANCE Section
            SliverToBoxAdapter(child: _SectionHeader(title: 'Appearance')),
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
            const SliverToBoxAdapter(child: SizedBox(height: 28)),

            // AI Section
            SliverToBoxAdapter(child: _SectionHeader(title: 'AI')),
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
                      _SettingsTile(
                        title: 'Providers',
                        subtitle: 'Models and API keys',
                        icon: Icons.psychology_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ProvidersScreen(),
                          ),
                        ),
                      ),
                      // TODO(artifacts): Re-enable when feature is ready
                      // _Divider(),
                      // _SettingsTile(
                      //   title: 'Artifacts',
                      //   subtitle: 'Search AI-created files and diffs',
                      //   icon: Icons.inventory_2_outlined,
                      //   onTap: () => Navigator.push(
                      //     context,
                      //     MaterialPageRoute(
                      //       builder: (_) => const ArtifactsScreen(),
                      //     ),
                      //   ),
                      // ),
                    ],
                  ),
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 28)),

            // OPENCODE Section (only when OpenCode is selected)
            if (currentAgent == AgentType.opencode) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _CollapsibleBackendSection(
                    title: 'OpenCode',
                    subtitle: 'Power features',
                    itemCount: 8,
                    isExpanded: _openCodeExpanded,
                    onToggle: () =>
                        setState(() => _openCodeExpanded = !_openCodeExpanded),
                    children: [
                      _SettingsTile(
                        title: 'Terminal Sessions',
                        subtitle: 'PTY terminal sessions',
                        icon: Icons.terminal_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const TerminalScreen(),
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
                                const SkillsScreen(backend: AgentType.opencode),
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
                          MaterialPageRoute(
                            builder: (_) => const OpenCodeCommandsScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Agents',
                        subtitle: '.opencode/agent/*.md',
                        icon: Icons.smart_toy_outlined,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const OpenCodeAgentsScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Plugins',
                        subtitle: '.opencode/plugin hooks',
                        icon: Icons.extension_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const OpenCodePluginsScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'MCP Servers',
                        subtitle: 'Model Context Protocol',
                        icon: Icons.dns_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const McpServersScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Tools',
                        subtitle: 'AI tools configuration',
                        icon: Icons.build_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ToolsScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Permission Rules',
                        subtitle: 'Default session permissions',
                        icon: Icons.security_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const PermissionRulesScreen(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 28)),
            ],

            // CLAUDE CODE Section (only when Claude Code is selected)
            if (currentAgent == AgentType.claudeCode) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _CollapsibleBackendSection(
                    title: 'Claude Code',
                    subtitle: 'Power features',
                    itemCount: 8,
                    isExpanded: _claudeCodeExpanded,
                    onToggle: () => setState(
                      () => _claudeCodeExpanded = !_claudeCodeExpanded,
                    ),
                    children: [
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
                            builder: (_) => const SkillsScreen(
                              backend: AgentType.claudeCode,
                            ),
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
                          MaterialPageRoute(
                            builder: (_) => const HooksScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'MCP',
                        subtitle: '.mcp.json configuration',
                        icon: Icons.dns_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ClaudeCodeMcpScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Subagents',
                        subtitle: 'Custom subagent definitions',
                        icon: Icons.smart_toy_outlined,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const SubagentsScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Custom Tools',
                        subtitle: 'HTTP APIs, scripts, and more',
                        icon: Icons.extension_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const CustomToolsScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Plugins',
                        subtitle: 'Commands, skills, hooks, MCP',
                        icon: Icons.extension_off_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const PluginsScreen(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 28)),
            ],

            // CODEX Section (only when Codex is selected)
            if (currentAgent == AgentType.codex) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _CollapsibleBackendSection(
                    title: 'Codex',
                    subtitle: 'Power features',
                    itemCount: 3,
                    isExpanded: _codexExpanded,
                    onToggle: () =>
                        setState(() => _codexExpanded = !_codexExpanded),
                    children: [
                      _SettingsTile(
                        title: 'Skills',
                        subtitle: 'SKILL.md management',
                        icon: Icons.auto_fix_high_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                const SkillsScreen(backend: AgentType.codex),
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
                          MaterialPageRoute(
                            builder: (_) => const CodexAgentsScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'MCP',
                        subtitle: 'Servers and config',
                        icon: Icons.dns_rounded,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const CodexMcpScreen(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 28)),
            ],

            // ACCOUNT Section
            SliverToBoxAdapter(child: _SectionHeader(title: 'Account')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: _SettingsTile(
                    title: 'Subscription Usage',
                    subtitle: 'API limits and credits',
                    icon: Icons.data_usage_rounded,
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const SubscriptionUsageScreen(),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 28)),

            // SUPPORT Section
            SliverToBoxAdapter(child: _SectionHeader(title: 'Support')),
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
            const SliverToBoxAdapter(child: SizedBox(height: 28)),

            // LEGAL Section
            SliverToBoxAdapter(child: _SectionHeader(title: 'Legal')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Privacy Policy',
                        subtitle: 'How we handle your data',
                        icon: Icons.privacy_tip_outlined,
                        onTap: () => launchUrl(
                          Uri.parse('https://broskiapp.com/legal/privacy'),
                          mode: LaunchMode.externalApplication,
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Terms of Service',
                        subtitle: 'Usage terms and conditions',
                        icon: Icons.description_outlined,
                        onTap: () => launchUrl(
                          Uri.parse('https://broskiapp.com/legal/terms'),
                          mode: LaunchMode.externalApplication,
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'EULA',
                        subtitle: 'End User License Agreement',
                        icon: Icons.gavel_rounded,
                        onTap: () => launchUrl(
                          Uri.parse(
                            'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
                          ),
                          mode: LaunchMode.externalApplication,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 28)),

            // ABOUT Section
            SliverToBoxAdapter(child: _SectionHeader(title: 'About')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Replay Onboarding',
                        subtitle: 'First-launch experience',
                        icon: Icons.replay_rounded,
                        onTap: () => _replayOnboarding(context, ref),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Enter Demo Mode',
                        subtitle: 'Preview App Store reviewer experience',
                        icon: Icons.play_circle_outline_rounded,
                        onTap: () {
                          ref.read(connectionProvider.notifier).enterDemoMode();
                          Navigator.of(
                            context,
                          ).popUntil((route) => route.isFirst);
                        },
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Clear Cache',
                        subtitle: 'Delete all cached data',
                        icon: Icons.delete_outline_rounded,
                        onTap: () => _showClearCacheDialog(context, ref),
                      ),
                      _Divider(),
                      _InfoTile(
                        title: 'Version',
                        value: appVersion,
                        icon: Icons.info_outline_rounded,
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Bottom padding
            const SliverToBoxAdapter(child: SizedBox(height: 100)),
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

class _ProjectPickerSheet extends ConsumerStatefulWidget {
  const _ProjectPickerSheet();

  @override
  ConsumerState<_ProjectPickerSheet> createState() =>
      _ProjectPickerSheetState();
}

class _ProjectPickerSheetState extends ConsumerState<_ProjectPickerSheet> {
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
    final height = MediaQuery.of(context).size.height * 0.75;
    final items = _filtered;

    return SafeArea(
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Select a project',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Refresh',
                    onPressed: _loading ? null : _load,
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: TextField(
                controller: _search,
                decoration: const InputDecoration(
                  hintText: 'Search projects',
                  prefixIcon: Icon(Icons.search_rounded),
                ),
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: theme.colorScheme.error),
                        ),
                      ),
                    )
                  : ListView.separated(
                      itemCount: items.length,
                      separatorBuilder: (_, __) => Divider(
                        height: 1,
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.08,
                        ),
                      ),
                      itemBuilder: (context, index) {
                        final p = items[index];
                        return ListTile(
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
                          onTap: () => Navigator.pop(context, p),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

// Active Connection Card (expandable)
class _ActiveConnectionCard extends StatefulWidget {
  const _ActiveConnectionCard({required this.connection});

  final BridgeConnectionState connection;

  @override
  State<_ActiveConnectionCard> createState() => _ActiveConnectionCardState();
}

class _ActiveConnectionCardState extends State<_ActiveConnectionCard> {
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
            // Header row (always visible)
            Row(
              children: [
                // Device icon
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
                // Device name and status
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
                // Expand/collapse indicator
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

            // Expanded details
            if (_isExpanded &&
                isConnected &&
                connection.connection != null) ...[
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: ocTheme.backgroundElement,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    // First row: Local IP and Port
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
                    // Second row: Tailscale IP and RTT (if available)
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
            ],
          ],
        ),
      ),
    );
  }
}

// Connection stat widget
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

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5),
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final themeData = Theme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: themeData.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: child,
    );
  }
}

/// Collapsible section for backend power features (OpenCode, Claude Code, Codex)
class _CollapsibleBackendSection extends StatelessWidget {
  const _CollapsibleBackendSection({
    required this.title,
    required this.subtitle,
    required this.itemCount,
    required this.isExpanded,
    required this.onToggle,
    required this.children,
  });

  final String title;
  final String subtitle;
  final int itemCount;
  final bool isExpanded;
  final VoidCallback onToggle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Tappable header
          InkWell(
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
                              title,
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
                                '$itemCount',
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
                          subtitle,
                          style: TextStyle(
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.6,
                            ),
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
          ),
          // Content (only when expanded)
          AnimatedCrossFade(
            firstChild: const SizedBox.shrink(),
            secondChild: Column(
              children: [
                Divider(
                  height: 1,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
                ),
                ...children,
              ],
            ),
            crossFadeState: isExpanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            duration: const Duration(milliseconds: 200),
          ),
        ],
      ),
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

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
    this.iconColor,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;
  final Color? iconColor;

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
            Icon(icon, color: iconColor ?? theme.colorScheme.primary, size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: iconColor ?? theme.colorScheme.onSurface,
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
          ],
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.title,
    required this.value,
    required this.icon,
  });

  final String title;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Icon(
            icon,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
            size: 22,
          ),
          const SizedBox(width: 12),
          Text(
            title,
            style: TextStyle(
              color: theme.colorScheme.onSurface,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              fontSize: 15,
            ),
          ),
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      thickness: 1,
      indent: 16,
      endIndent: 16,
      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.1),
    );
  }
}
