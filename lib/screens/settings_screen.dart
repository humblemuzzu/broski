import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../providers/agent_type_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/input_style_provider.dart';
import '../providers/onboarding_provider.dart';
import '../providers/service_providers.dart';
import '../providers/theme_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/connection_quality_indicator.dart';
import 'appearance_screen.dart';
import 'device_manager_screen.dart';
import 'mcp_servers_screen.dart';
import 'providers_screen.dart';
import 'terminal_screen.dart';
import 'theme_selector_screen.dart';
import 'tools_screen.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionProvider);
    final currentThemeInfo = ref.watch(currentThemeInfoProvider);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            // Modern header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
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

            // Active Connection (if connected)
            if (connection.connection != null && connection.isConnected) ...[
              SliverToBoxAdapter(
                child: _SectionHeader(title: 'Active Connection'),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _ActiveConnectionCard(connection: connection),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 24)),
            ],

            // AI Backend section
            SliverToBoxAdapter(child: _SectionHeader(title: 'AI Backend')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _AgentTypeTile(
                        agentType: AgentType.opencode,
                        title: 'OpenCode',
                        subtitle: 'Open source AI coding agent',
                        icon: Icons.code_rounded,
                      ),
                      _Divider(),
                      _AgentTypeTile(
                        agentType: AgentType.claudeCode,
                        title: 'Claude Code',
                        subtitle:
                            'Anthropic Claude Code SDK (requires API key)',
                        icon: Icons.auto_awesome_rounded,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),

            // Appearance section
            SliverToBoxAdapter(child: _SectionHeader(title: 'Appearance')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Theme',
                        subtitle: currentThemeInfo?.name ?? 'OpenCode',
                        icon: Icons.palette_rounded,
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // Theme color indicator
                            Container(
                              width: 16,
                              height: 16,
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
                            const Icon(Icons.chevron_right_rounded, size: 20),
                          ],
                        ),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ThemeSelectorScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Tool Cards',
                        subtitle: 'Icons, colors, and card styling',
                        icon: Icons.view_agenda_rounded,
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                        ),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const AppearanceScreen(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Interface section
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
            SliverToBoxAdapter(child: _SectionHeader(title: 'Interface')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _InputStyleTile(
                        title: 'ChatGPT Style',
                        subtitle: 'Rounded pill input with send button',
                        icon: Icons.chat_bubble_outline_rounded,
                        value: InputBarStyle.chatgpt,
                      ),
                      _Divider(),
                      _InputStyleTile(
                        title: 'CLI Style',
                        subtitle:
                            'Terminal-like input with agent & model selector',
                        icon: Icons.terminal_rounded,
                        value: InputBarStyle.cli,
                      ),
                      _Divider(),
                      _NotificationToggleTile(),
                    ],
                  ),
                ),
              ),
            ),

            // Management section
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
            SliverToBoxAdapter(child: _SectionHeader(title: 'Management')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Device Manager',
                        subtitle: 'Paired Macs and connection info',
                        icon: Icons.devices_rounded,
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                        ),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const DeviceManagerScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'OpenCode Providers',
                        subtitle: 'Models configured in OpenCode CLI',
                        icon: Icons.psychology_rounded,
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                        ),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ProvidersScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Terminal Sessions',
                        subtitle: 'PTY terminal sessions on your Mac',
                        icon: Icons.terminal_rounded,
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                        ),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const TerminalScreen(),
                          ),
                        ),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'MCP Servers',
                        subtitle: 'Model Context Protocol servers',
                        icon: Icons.dns_rounded,
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                        ),
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
                        subtitle: 'AI tools (bash, edit, read, etc.)',
                        icon: Icons.build_rounded,
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          size: 20,
                        ),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ToolsScreen(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Actions section
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
            SliverToBoxAdapter(child: _SectionHeader(title: 'Actions')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Column(
                  children: [
                    if (!connection.opencodeRunning) ...[
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: () => _startOpenCode(context, ref),
                          icon: const Icon(Icons.play_arrow_rounded),
                          label: const Text('Start OpenCode'),
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => ref
                            .read(connectionProvider.notifier)
                            .clearConnection(),
                        icon: const Icon(Icons.clear_rounded, size: 20),
                        label: const Text('Clear Connection'),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () =>
                            ref.read(connectionProvider.notifier).disconnect(),
                        icon: const Icon(Icons.link_off_rounded, size: 20),
                        label: const Text('Disconnect'),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          foregroundColor: theme.colorScheme.error,
                          side: BorderSide(color: theme.colorScheme.error),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Debug section
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
            SliverToBoxAdapter(child: _SectionHeader(title: 'Debug')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: _SettingsTile(
                    title: 'Replay Onboarding',
                    subtitle: 'See the first-launch experience again',
                    icon: Icons.replay_rounded,
                    trailing: const Icon(Icons.chevron_right_rounded, size: 20),
                    onTap: () => _replayOnboarding(context, ref),
                  ),
                ),
              ),
            ),

            // Bottom padding for navbar
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

  Future<void> _startOpenCode(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final surfaceColor = Theme.of(context).colorScheme.surface;
    messenger.showSnackBar(
      SnackBar(
        content: const Text('Restarting OpenCode...'),
        backgroundColor: surfaceColor,
        behavior: SnackBarBehavior.floating,
      ),
    );

    final ok = await ref.read(bridgeServiceProvider).restartOpenCode();
    messenger.showSnackBar(
      SnackBar(
        content: Text(ok ? 'OpenCode restarted' : 'Failed to restart OpenCode'),
        backgroundColor: surfaceColor,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

// Active Connection Card (inspired by the image)
class _ActiveConnectionCard extends StatelessWidget {
  const _ActiveConnectionCard({required this.connection});

  final BridgeConnectionState connection;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final isConnected = connection.isConnected;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        children: [
          // Device info row
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
                    // Connection quality indicator with signal bars
                    const ConnectionQualityIndicator(),
                  ],
                ),
              ),
            ],
          ),

          // Stats row (if connected)
          if (isConnected && connection.connection != null) ...[
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
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
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

    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: child,
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.title,
    this.subtitle,
    this.icon,
    this.trailing,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(icon, color: theme.colorScheme.primary, size: 22),
              const SizedBox(width: 12),
            ],
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
                  if (subtitle != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      subtitle!,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.6,
                        ),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 8), trailing!],
          ],
        ),
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

// Input bar style selector tile
class _InputStyleTile extends ConsumerWidget {
  const _InputStyleTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.value,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final InputBarStyle value;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final currentStyle = ref.watch(inputStyleProvider);

    return InkWell(
      onTap: () => ref.read(inputStyleProvider.notifier).setStyle(value),
      borderRadius: BorderRadius.circular(20),
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
                  const SizedBox(height: 4),
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
            const SizedBox(width: 8),
            Radio<InputBarStyle>(
              value: value,
              groupValue: currentStyle,
              onChanged: (v) {
                if (v != null) {
                  ref.read(inputStyleProvider.notifier).setStyle(v);
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationToggleTile extends ConsumerWidget {
  const _NotificationToggleTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final enabled = ref.watch(notificationsEnabledProvider);

    return InkWell(
      onTap: () => ref.read(notificationsEnabledProvider.notifier).toggle(),
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              Icons.notifications_rounded,
              color: theme.colorScheme.primary,
              size: 22,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Notifications',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Alert when background sessions complete',
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Switch.adaptive(
              value: enabled,
              onChanged: (v) =>
                  ref.read(notificationsEnabledProvider.notifier).setEnabled(v),
            ),
          ],
        ),
      ),
    );
  }
}

class _AgentTypeTile extends ConsumerWidget {
  const _AgentTypeTile({
    required this.agentType,
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final AgentType agentType;
  final String title;
  final String subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final currentAgent = ref.watch(agentTypeProvider);
    final isSelected = currentAgent == agentType;

    return InkWell(
      onTap: () {
        ref.read(agentTypeProvider.notifier).setAgentType(agentType);
        final bridge = ref.read(bridgeServiceProvider);
        bridge.setAgent(agentType);
      },
      borderRadius: BorderRadius.circular(20),
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
                  const SizedBox(height: 4),
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
            const SizedBox(width: 8),
            Radio<AgentType>(
              value: agentType,
              groupValue: currentAgent,
              onChanged: (v) {
                if (v != null) {
                  ref.read(agentTypeProvider.notifier).setAgentType(v);
                  final bridge = ref.read(bridgeServiceProvider);
                  bridge.setAgent(v);
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
