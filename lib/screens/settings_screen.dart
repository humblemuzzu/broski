import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/theme_provider.dart';
import 'device_manager_screen.dart';
import 'mcp_servers_screen.dart';
import 'providers_screen.dart';
import 'terminal_screen.dart';
import 'tools_screen.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionProvider);
    final themeMode = ref.watch(themeProvider);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
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

            // Appearance section
            SliverToBoxAdapter(child: _SectionHeader(title: 'Appearance')),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _SettingsCard(
                  child: Column(
                    children: [
                      _SettingsTile(
                        title: 'Dark Blue Theme',
                        subtitle: 'Original blue-tinted dark theme',
                        trailing: Radio<AppThemeMode>(
                          value: AppThemeMode.dark,
                          groupValue: themeMode,
                          onChanged: (value) {
                            if (value != null) {
                              ref.read(themeProvider.notifier).setTheme(value);
                            }
                          },
                        ),
                        onTap: () => ref
                            .read(themeProvider.notifier)
                            .setTheme(AppThemeMode.dark),
                      ),
                      _Divider(),
                      _SettingsTile(
                        title: 'Pure Black Theme',
                        subtitle: 'OLED-friendly pure black theme',
                        trailing: Radio<AppThemeMode>(
                          value: AppThemeMode.black,
                          groupValue: themeMode,
                          onChanged: (value) {
                            if (value != null) {
                              ref.read(themeProvider.notifier).setTheme(value);
                            }
                          },
                        ),
                        onTap: () => ref
                            .read(themeProvider.notifier)
                            .setTheme(AppThemeMode.black),
                      ),
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

            // Bottom padding for navbar
            const SliverToBoxAdapter(child: SizedBox(height: 100)),
          ],
        ),
      ),
    );
  }

  void _startOpenCode(BuildContext context, WidgetRef ref) {
    ref.read(bridgeServiceProvider).startOpenCode();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Starting OpenCode on your Mac...'),
        backgroundColor: Theme.of(context).colorScheme.surface,
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
    final isConnected = connection.isConnected;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1C1C1E),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
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
                    Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: isConnected
                                ? const Color(0xFF10B981)
                                : theme.colorScheme.error,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          isConnected ? 'Connected' : 'Disconnected',
                          style: TextStyle(
                            color: isConnected
                                ? const Color(0xFF10B981)
                                : theme.colorScheme.error,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (connection.connection?.localIP != null) ...[
                          Text(
                            ' • ${connection.connection!.localIP}',
                            style: TextStyle(
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: 0.6,
                              ),
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ],
                    ),
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
                color: const Color(0xFF0D0D0D),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  // Local IP
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
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
                  ),
                  // Port
                  Expanded(
                    child: _ConnectionStat(
                      label: 'Port',
                      value: '${connection.connection!.port ?? 'N/A'}',
                      icon: Icons.settings_ethernet_rounded,
                    ),
                  ),
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
    final theme = Theme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1C1C1E),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
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
