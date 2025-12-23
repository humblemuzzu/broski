import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../widgets/connection_indicator.dart';
import 'device_manager_screen.dart';
import 'providers_screen.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ConnectionIndicator(
              status: connection.status,
              opencodeRunning: connection.opencodeRunning,
              compact: true,
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Connection', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          if (connection.connection != null) ...[
            ListTile(
              title: const Text('Local IP'),
              subtitle: Text(connection.connection?.localIP ?? 'Not available'),
            ),
            ListTile(
              title: const Text('Tailscale IP'),
              subtitle: Text(connection.connection?.tailscaleIP ?? 'Not available'),
            ),
            ListTile(
              title: const Text('Port'),
              subtitle: Text('${connection.connection?.port ?? '-'}'),
            ),
          ] else ...[
            const Text('Not connected to a bridge yet.'),
          ],
          const SizedBox(height: 24),
          Text('Devices', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          ListTile(
            title: const Text('Device manager'),
            subtitle: const Text('Paired Macs and connection info'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const DeviceManagerScreen()),
            ),
          ),
          const SizedBox(height: 20),
          Text('Providers', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          ListTile(
            title: const Text('OpenCode providers'),
            subtitle: const Text('Models configured in OpenCode CLI'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ProvidersScreen()),
            ),
          ),
          const SizedBox(height: 20),
          Text('Actions', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          if (!connection.opencodeRunning) ...[
            ElevatedButton(
              onPressed: () => _startOpenCode(context, ref),
              child: const Text('Start OpenCode'),
            ),
            const SizedBox(height: 12),
          ],
          ElevatedButton(
            onPressed: () => ref.read(connectionProvider.notifier).clearConnection(),
            child: const Text('Clear connection'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => ref.read(connectionProvider.notifier).disconnect(),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
  }

  void _startOpenCode(BuildContext context, WidgetRef ref) {
    ref.read(bridgeServiceProvider).startOpenCode();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Starting OpenCode on your Mac...')),
    );
  }
}
